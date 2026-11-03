/* A second Vulkan device standing in for a browser engine's compositor: it creates an RGBA8 image
 * whose memory can be exported as an opaque file descriptor, uploads a test pattern into it, leaves
 * it in VK_IMAGE_LAYOUT_GENERAL released to the external queue family, and hands the descriptor
 * and its creation parameters to Dawn. Linux only; it links the system Vulkan loader. */
#include <stdint.h>
#include <string.h>
#include <vulkan/vulkan.h>

typedef struct SilkProducer {
    VkInstance instance;
    VkPhysicalDevice physical;
    VkDevice device;
    VkImage image;
    VkDeviceMemory memory;
    VkExternalMemoryImageCreateInfo external;
    VkImageCreateInfo imageInfo;
    uint32_t memoryTypeIndex;
    uint64_t allocationSize;
    int32_t fd;
    int32_t failedStep;
    int32_t result;
} SilkProducer;

static SilkProducer producer;

static int32_t fail(int32_t step, VkResult result) {
    producer.failedStep = step;
    producer.result = (int32_t)result;
    return step;
}

/* Fills the image with `pixels` (width * height * 4 bytes, RGBA). Returns 0, or the failing step. */
int32_t silkProducerCreate(uint32_t width, uint32_t height, const uint8_t *pixels) {
    memset(&producer, 0, sizeof producer);
    producer.fd = -1;
    VkApplicationInfo app = {VK_STRUCTURE_TYPE_APPLICATION_INFO};
    app.apiVersion = VK_API_VERSION_1_1;
    VkInstanceCreateInfo instanceInfo = {VK_STRUCTURE_TYPE_INSTANCE_CREATE_INFO};
    instanceInfo.pApplicationInfo = &app;
    VkResult r = vkCreateInstance(&instanceInfo, NULL, &producer.instance);
    if (r != VK_SUCCESS) return fail(1, r);
    uint32_t count = 1;
    r = vkEnumeratePhysicalDevices(producer.instance, &count, &producer.physical);
    if ((r != VK_SUCCESS && r != VK_INCOMPLETE) || count == 0) return fail(2, r);

    float priority = 1.0f;
    VkDeviceQueueCreateInfo queueInfo = {VK_STRUCTURE_TYPE_DEVICE_QUEUE_CREATE_INFO};
    queueInfo.queueCount = 1;
    queueInfo.pQueuePriorities = &priority;
    const char *extensions[] = {"VK_KHR_external_memory_fd"};
    VkDeviceCreateInfo deviceInfo = {VK_STRUCTURE_TYPE_DEVICE_CREATE_INFO};
    deviceInfo.queueCreateInfoCount = 1;
    deviceInfo.pQueueCreateInfos = &queueInfo;
    deviceInfo.enabledExtensionCount = 1;
    deviceInfo.ppEnabledExtensionNames = extensions;
    r = vkCreateDevice(producer.physical, &deviceInfo, NULL, &producer.device);
    if (r != VK_SUCCESS) return fail(3, r);
    VkDevice device = producer.device;

    /* Dawn checks that the create info it is given matches the image and chains the external
     * memory info, and needs MUTABLE_FORMAT for its views. */
    producer.external = (VkExternalMemoryImageCreateInfo){VK_STRUCTURE_TYPE_EXTERNAL_MEMORY_IMAGE_CREATE_INFO};
    producer.external.handleTypes = VK_EXTERNAL_MEMORY_HANDLE_TYPE_OPAQUE_FD_BIT;
    VkImageCreateInfo *info = &producer.imageInfo;
    *info = (VkImageCreateInfo){VK_STRUCTURE_TYPE_IMAGE_CREATE_INFO};
    info->pNext = &producer.external;
    info->flags = VK_IMAGE_CREATE_MUTABLE_FORMAT_BIT;
    info->imageType = VK_IMAGE_TYPE_2D;
    info->format = VK_FORMAT_R8G8B8A8_UNORM;
    info->extent = (VkExtent3D){width, height, 1};
    info->mipLevels = 1;
    info->arrayLayers = 1;
    info->samples = VK_SAMPLE_COUNT_1_BIT;
    info->tiling = VK_IMAGE_TILING_OPTIMAL;
    info->usage = VK_IMAGE_USAGE_TRANSFER_SRC_BIT | VK_IMAGE_USAGE_TRANSFER_DST_BIT |
                  VK_IMAGE_USAGE_SAMPLED_BIT | VK_IMAGE_USAGE_COLOR_ATTACHMENT_BIT;
    r = vkCreateImage(device, info, NULL, &producer.image);
    if (r != VK_SUCCESS) return fail(4, r);

    VkMemoryRequirements requirements;
    vkGetImageMemoryRequirements(device, producer.image, &requirements);
    VkPhysicalDeviceMemoryProperties properties;
    vkGetPhysicalDeviceMemoryProperties(producer.physical, &properties);
    uint32_t type = 0;
    while (type < properties.memoryTypeCount && !(requirements.memoryTypeBits & (1u << type))) type++;
    if (type == properties.memoryTypeCount) return fail(5, VK_ERROR_UNKNOWN);
    VkMemoryDedicatedAllocateInfo dedicated = {VK_STRUCTURE_TYPE_MEMORY_DEDICATED_ALLOCATE_INFO};
    dedicated.image = producer.image;
    VkExportMemoryAllocateInfo exportInfo = {VK_STRUCTURE_TYPE_EXPORT_MEMORY_ALLOCATE_INFO};
    exportInfo.pNext = &dedicated;
    exportInfo.handleTypes = VK_EXTERNAL_MEMORY_HANDLE_TYPE_OPAQUE_FD_BIT;
    VkMemoryAllocateInfo allocation = {VK_STRUCTURE_TYPE_MEMORY_ALLOCATE_INFO};
    allocation.pNext = &exportInfo;
    allocation.allocationSize = requirements.size;
    allocation.memoryTypeIndex = type;
    r = vkAllocateMemory(device, &allocation, NULL, &producer.memory);
    if (r != VK_SUCCESS) return fail(6, r);
    r = vkBindImageMemory(device, producer.image, producer.memory, 0);
    if (r != VK_SUCCESS) return fail(7, r);
    producer.memoryTypeIndex = type;
    producer.allocationSize = requirements.size;

    /* Upload through a host-visible staging buffer. */
    VkDeviceSize bytes = (VkDeviceSize)width * height * 4;
    VkBufferCreateInfo bufferInfo = {VK_STRUCTURE_TYPE_BUFFER_CREATE_INFO};
    bufferInfo.size = bytes;
    bufferInfo.usage = VK_BUFFER_USAGE_TRANSFER_SRC_BIT;
    VkBuffer staging;
    r = vkCreateBuffer(device, &bufferInfo, NULL, &staging);
    if (r != VK_SUCCESS) return fail(8, r);
    VkMemoryRequirements bufferRequirements;
    vkGetBufferMemoryRequirements(device, staging, &bufferRequirements);
    uint32_t hostType = 0;
    while (hostType < properties.memoryTypeCount &&
           !((bufferRequirements.memoryTypeBits & (1u << hostType)) &&
             (properties.memoryTypes[hostType].propertyFlags & VK_MEMORY_PROPERTY_HOST_VISIBLE_BIT) &&
             (properties.memoryTypes[hostType].propertyFlags & VK_MEMORY_PROPERTY_HOST_COHERENT_BIT)))
        hostType++;
    if (hostType == properties.memoryTypeCount) return fail(9, VK_ERROR_UNKNOWN);
    VkMemoryAllocateInfo stagingAllocation = {VK_STRUCTURE_TYPE_MEMORY_ALLOCATE_INFO};
    stagingAllocation.allocationSize = bufferRequirements.size;
    stagingAllocation.memoryTypeIndex = hostType;
    VkDeviceMemory stagingMemory;
    r = vkAllocateMemory(device, &stagingAllocation, NULL, &stagingMemory);
    if (r != VK_SUCCESS) return fail(10, r);
    vkBindBufferMemory(device, staging, stagingMemory, 0);
    void *mapped;
    r = vkMapMemory(device, stagingMemory, 0, bytes, 0, &mapped);
    if (r != VK_SUCCESS) return fail(11, r);
    memcpy(mapped, pixels, (size_t)bytes);
    vkUnmapMemory(device, stagingMemory);

    VkCommandPoolCreateInfo poolInfo = {VK_STRUCTURE_TYPE_COMMAND_POOL_CREATE_INFO};
    VkCommandPool pool;
    r = vkCreateCommandPool(device, &poolInfo, NULL, &pool);
    if (r != VK_SUCCESS) return fail(12, r);
    VkCommandBufferAllocateInfo commandInfo = {VK_STRUCTURE_TYPE_COMMAND_BUFFER_ALLOCATE_INFO};
    commandInfo.commandPool = pool;
    commandInfo.level = VK_COMMAND_BUFFER_LEVEL_PRIMARY;
    commandInfo.commandBufferCount = 1;
    VkCommandBuffer commands;
    r = vkAllocateCommandBuffers(device, &commandInfo, &commands);
    if (r != VK_SUCCESS) return fail(13, r);
    VkCommandBufferBeginInfo begin = {VK_STRUCTURE_TYPE_COMMAND_BUFFER_BEGIN_INFO};
    begin.flags = VK_COMMAND_BUFFER_USAGE_ONE_TIME_SUBMIT_BIT;
    vkBeginCommandBuffer(commands, &begin);
    VkImageMemoryBarrier barrier = {VK_STRUCTURE_TYPE_IMAGE_MEMORY_BARRIER};
    barrier.srcQueueFamilyIndex = VK_QUEUE_FAMILY_IGNORED;
    barrier.dstQueueFamilyIndex = VK_QUEUE_FAMILY_IGNORED;
    barrier.oldLayout = VK_IMAGE_LAYOUT_UNDEFINED;
    barrier.newLayout = VK_IMAGE_LAYOUT_TRANSFER_DST_OPTIMAL;
    barrier.dstAccessMask = VK_ACCESS_TRANSFER_WRITE_BIT;
    barrier.image = producer.image;
    barrier.subresourceRange = (VkImageSubresourceRange){VK_IMAGE_ASPECT_COLOR_BIT, 0, 1, 0, 1};
    vkCmdPipelineBarrier(commands, VK_PIPELINE_STAGE_TOP_OF_PIPE_BIT, VK_PIPELINE_STAGE_TRANSFER_BIT, 0,
                         0, NULL, 0, NULL, 1, &barrier);
    VkBufferImageCopy region = {0};
    region.imageSubresource = (VkImageSubresourceLayers){VK_IMAGE_ASPECT_COLOR_BIT, 0, 0, 1};
    region.imageExtent = (VkExtent3D){width, height, 1};
    vkCmdCopyBufferToImage(commands, staging, producer.image, VK_IMAGE_LAYOUT_TRANSFER_DST_OPTIMAL, 1, &region);
    /* Release to the consumer: Dawn acquires from the external queue family in GENERAL. */
    barrier.oldLayout = VK_IMAGE_LAYOUT_TRANSFER_DST_OPTIMAL;
    barrier.newLayout = VK_IMAGE_LAYOUT_GENERAL;
    barrier.srcAccessMask = VK_ACCESS_TRANSFER_WRITE_BIT;
    barrier.dstAccessMask = 0;
    barrier.srcQueueFamilyIndex = 0;
    barrier.dstQueueFamilyIndex = VK_QUEUE_FAMILY_EXTERNAL;
    vkCmdPipelineBarrier(commands, VK_PIPELINE_STAGE_TRANSFER_BIT, VK_PIPELINE_STAGE_BOTTOM_OF_PIPE_BIT, 0,
                         0, NULL, 0, NULL, 1, &barrier);
    vkEndCommandBuffer(commands);
    VkQueue queue;
    vkGetDeviceQueue(device, 0, 0, &queue);
    VkSubmitInfo submit = {VK_STRUCTURE_TYPE_SUBMIT_INFO};
    submit.commandBufferCount = 1;
    submit.pCommandBuffers = &commands;
    r = vkQueueSubmit(queue, 1, &submit, VK_NULL_HANDLE);
    if (r != VK_SUCCESS) return fail(14, r);
    /* No semaphore to hand over: wait here instead. */
    vkQueueWaitIdle(queue);
    vkDestroyCommandPool(device, pool, NULL);
    vkDestroyBuffer(device, staging, NULL);
    vkFreeMemory(device, stagingMemory, NULL);

    PFN_vkGetMemoryFdKHR getMemoryFd = (PFN_vkGetMemoryFdKHR)vkGetDeviceProcAddr(device, "vkGetMemoryFdKHR");
    if (getMemoryFd == NULL) return fail(15, VK_ERROR_EXTENSION_NOT_PRESENT);
    VkMemoryGetFdInfoKHR fdInfo = {VK_STRUCTURE_TYPE_MEMORY_GET_FD_INFO_KHR};
    fdInfo.memory = producer.memory;
    fdInfo.handleType = VK_EXTERNAL_MEMORY_HANDLE_TYPE_OPAQUE_FD_BIT;
    int fd = -1;
    r = getMemoryFd(device, &fdInfo, &fd);
    if (r != VK_SUCCESS) return fail(16, r);
    producer.fd = fd;
    return 0;
}

int32_t silkProducerFd(void) { return producer.fd; }
uint32_t silkProducerMemoryTypeIndex(void) { return producer.memoryTypeIndex; }
uint64_t silkProducerAllocationSize(void) { return producer.allocationSize; }
const void *silkProducerImageCreateInfo(void) { return &producer.imageInfo; }
int32_t silkProducerResult(void) { return producer.result; }
/* VK_IMAGE_LAYOUT_GENERAL, the layout the image is released in. */
int32_t silkProducerLayout(void) { return (int32_t)VK_IMAGE_LAYOUT_GENERAL; }
