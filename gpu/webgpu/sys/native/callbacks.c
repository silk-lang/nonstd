#include <webgpu/webgpu.h>

_Static_assert(WGPUFeatureName_ShaderModuleCompilationOptions == 0x0005002e,
               "Update resources.SHADER_MODULE_COMPILATION_OPTIONS for the pinned Dawn ABI");

/* LIMITATION-4: Silk requires one callback invocation mode per declaration. */
void silkWebgpuRegisterError(WGPUDeviceDescriptor *descriptor,
                            WGPUUncapturedErrorCallback callback) {
    descriptor->uncapturedErrorCallbackInfo.callback = callback;
}

WGPUFuture silkWebgpuRequestDevice(WGPUAdapter adapter,
                                  WGPUDeviceDescriptor *descriptor,
                                  WGPUDeviceLostCallback lostCallback,
                                  WGPURequestDeviceCallbackInfo callbackInfo) {
    descriptor->deviceLostCallbackInfo.callback = lostCallback;
    return wgpuAdapterRequestDevice(adapter, descriptor, callbackInfo);
}

/* Dawn's native extension is deliberately opt-in per shader, not a device-wide math toggle. */
WGPUShaderModule silkWebgpuCreateShaderModuleStrict(WGPUDevice device,
                                                  const WGPUShaderModuleDescriptor *descriptor) {
    WGPUShaderModuleDescriptor strict = *descriptor;
    WGPUShaderModuleCompilationOptions options = WGPU_SHADER_MODULE_COMPILATION_OPTIONS_INIT;
    options.strictMath = WGPU_TRUE;
    options.chain.next = descriptor->nextInChain;
    strict.nextInChain = &options.chain;
    return wgpuDeviceCreateShaderModule(device, &strict);
}

/* Dawn's shared texture memory and shared fences: Dawn extensions outside the webgpu.h schema the
 * generated bindings follow. These helpers take flat arguments so Silk never mirrors Dawn's
 * extension structs; gpu-webgpu's `shared_texture` module wraps them. */
_Static_assert(WGPUFeatureName_SharedTextureMemoryDmaBuf == 0x0005001f, "Update shared_texture.FEATURE_DMA_BUF");
_Static_assert(WGPUFeatureName_SharedTextureMemoryOpaqueFD == 0x00050020, "Update shared_texture.FEATURE_OPAQUE_FD");
_Static_assert(WGPUFeatureName_SharedTextureMemoryDXGISharedHandle == 0x00050022, "Update shared_texture.FEATURE_DXGI_SHARED_HANDLE");
_Static_assert(WGPUFeatureName_SharedTextureMemoryIOSurface == 0x00050024, "Update shared_texture.FEATURE_IOSURFACE");
_Static_assert(WGPUFeatureName_SharedFenceVkSemaphoreOpaqueFD == 0x00050026, "Update shared_texture.FEATURE_FENCE_VK_SEMAPHORE_OPAQUE_FD");
_Static_assert(WGPUFeatureName_SharedFenceSyncFD == 0x00050027, "Update shared_texture.FEATURE_FENCE_SYNC_FD");
_Static_assert(WGPUFeatureName_SharedFenceDXGISharedHandle == 0x00050029, "Update shared_texture.FEATURE_FENCE_DXGI_SHARED_HANDLE");
_Static_assert(WGPUFeatureName_SharedFenceMTLSharedEvent == 0x0005002a, "Update shared_texture.FEATURE_FENCE_MTL_SHARED_EVENT");
_Static_assert(WGPUSharedFenceType_VkSemaphoreOpaqueFD == 1 && WGPUSharedFenceType_SyncFD == 2 &&
               WGPUSharedFenceType_DXGISharedHandle == 4 && WGPUSharedFenceType_MTLSharedEvent == 5,
               "Update shared_texture's fence type constants");

#define SILK_SHARED_MAX_PLANES 4

static WGPUSharedTextureMemory silkImport(WGPUDevice device, WGPUStringView label, WGPUChainedStruct *chain) {
    WGPUSharedTextureMemoryDescriptor descriptor = WGPU_SHARED_TEXTURE_MEMORY_DESCRIPTOR_INIT;
    descriptor.nextInChain = chain;
    descriptor.label = label;
    return wgpuDeviceImportSharedTextureMemory(device, &descriptor);
}

WGPUSharedTextureMemory silkWebgpuImportDmaBuf(WGPUDevice device, WGPUStringView label, uint32_t width,
                                               uint32_t height, uint32_t drmFormat, uint64_t drmModifier,
                                               size_t planeCount, const int32_t *fds,
                                               const uint64_t *offsets, const uint32_t *strides) {
    if (planeCount == 0 || planeCount > SILK_SHARED_MAX_PLANES) {
        return NULL;
    }
    WGPUSharedTextureMemoryDmaBufPlane planes[SILK_SHARED_MAX_PLANES];
    for (size_t i = 0; i < planeCount; i++) {
        planes[i].fd = fds[i];
        planes[i].offset = offsets[i];
        planes[i].stride = strides[i];
    }
    WGPUSharedTextureMemoryDmaBufDescriptor dmaBuf = WGPU_SHARED_TEXTURE_MEMORY_DMA_BUF_DESCRIPTOR_INIT;
    dmaBuf.size.width = width;
    dmaBuf.size.height = height;
    dmaBuf.size.depthOrArrayLayers = 1;
    dmaBuf.drmFormat = drmFormat;
    dmaBuf.drmModifier = drmModifier;
    dmaBuf.planeCount = planeCount;
    dmaBuf.planes = planes;
    return silkImport(device, label, &dmaBuf.chain);
}

WGPUSharedTextureMemory silkWebgpuImportOpaqueFd(WGPUDevice device, WGPUStringView label,
                                                 const void *vkImageCreateInfo, int32_t memoryFd,
                                                 uint32_t memoryTypeIndex, uint64_t allocationSize,
                                                 uint32_t dedicatedAllocation) {
    WGPUSharedTextureMemoryOpaqueFDDescriptor opaque = WGPU_SHARED_TEXTURE_MEMORY_OPAQUE_FD_DESCRIPTOR_INIT;
    opaque.vkImageCreateInfo = vkImageCreateInfo;
    opaque.memoryFD = memoryFd;
    opaque.memoryTypeIndex = memoryTypeIndex;
    opaque.allocationSize = allocationSize;
    opaque.dedicatedAllocation = dedicatedAllocation ? WGPU_TRUE : WGPU_FALSE;
    return silkImport(device, label, &opaque.chain);
}

WGPUSharedTextureMemory silkWebgpuImportIOSurface(WGPUDevice device, WGPUStringView label, void *ioSurface) {
    WGPUSharedTextureMemoryIOSurfaceDescriptor surface = WGPU_SHARED_TEXTURE_MEMORY_IO_SURFACE_DESCRIPTOR_INIT;
    surface.ioSurface = ioSurface;
    return silkImport(device, label, &surface.chain);
}

WGPUSharedTextureMemory silkWebgpuImportDxgiSharedHandle(WGPUDevice device, WGPUStringView label,
                                                         void *handle, uint32_t useKeyedMutex) {
    WGPUSharedTextureMemoryDXGISharedHandleDescriptor shared = WGPU_SHARED_TEXTURE_MEMORY_DXGI_SHARED_HANDLE_DESCRIPTOR_INIT;
    shared.handle = handle;
    shared.useKeyedMutex = useKeyedMutex ? WGPU_TRUE : WGPU_FALSE;
    return silkImport(device, label, &shared.chain);
}

/* out: width, height, format, usage low word, usage high word. */
WGPUStatus silkWebgpuSharedTextureMemoryProperties(WGPUSharedTextureMemory memory, uint32_t *out) {
    WGPUSharedTextureMemoryProperties properties = WGPU_SHARED_TEXTURE_MEMORY_PROPERTIES_INIT;
    WGPUStatus status = wgpuSharedTextureMemoryGetProperties(memory, &properties);
    out[0] = properties.size.width;
    out[1] = properties.size.height;
    out[2] = (uint32_t)properties.format;
    out[3] = (uint32_t)(properties.usage & 0xffffffffu);
    out[4] = (uint32_t)(properties.usage >> 32);
    return status;
}

WGPUTexture silkWebgpuSharedTextureMemoryCreateTexture(WGPUSharedTextureMemory memory, WGPUStringView label) {
    WGPUSharedTextureMemoryProperties properties = WGPU_SHARED_TEXTURE_MEMORY_PROPERTIES_INIT;
    if (wgpuSharedTextureMemoryGetProperties(memory, &properties) != WGPUStatus_Success) {
        return wgpuSharedTextureMemoryCreateTexture(memory, NULL);
    }
    WGPUTextureDescriptor descriptor = WGPU_TEXTURE_DESCRIPTOR_INIT;
    descriptor.label = label;
    descriptor.usage = properties.usage;
    descriptor.size = properties.size;
    descriptor.format = properties.format;
    return wgpuSharedTextureMemoryCreateTexture(memory, &descriptor);
}

/* A Vulkan layout pair applies only when useVkLayout is nonzero (images a Vulkan producer handed
 * over in a known layout). */
WGPUStatus silkWebgpuSharedTextureMemoryBeginAccess(WGPUSharedTextureMemory memory, WGPUTexture texture,
                                                    uint32_t initialized, uint32_t concurrentRead,
                                                    size_t fenceCount, const WGPUSharedFence *fences,
                                                    const uint64_t *signaledValues, uint32_t useVkLayout,
                                                    int32_t vkOldLayout, int32_t vkNewLayout) {
    WGPUSharedTextureMemoryVkImageLayoutBeginState layout = WGPU_SHARED_TEXTURE_MEMORY_VK_IMAGE_LAYOUT_BEGIN_STATE_INIT;
    layout.oldLayout = vkOldLayout;
    layout.newLayout = vkNewLayout;
    WGPUSharedTextureMemoryBeginAccessDescriptor descriptor = WGPU_SHARED_TEXTURE_MEMORY_BEGIN_ACCESS_DESCRIPTOR_INIT;
    descriptor.nextInChain = useVkLayout ? &layout.chain : NULL;
    descriptor.initialized = initialized ? WGPU_TRUE : WGPU_FALSE;
    descriptor.concurrentRead = concurrentRead ? WGPU_TRUE : WGPU_FALSE;
    descriptor.fenceCount = fenceCount;
    descriptor.fences = fences;
    descriptor.signaledValueCount = fenceCount;
    descriptor.signaledValues = signaledValues;
    return wgpuSharedTextureMemoryBeginAccess(memory, texture, &descriptor);
}

/* The end state the caller reads back: whether the contents are initialized, the fences to wait
 * on before the producer reuses the memory (each with one reference the caller releases), and on
 * Vulkan the layouts the image was left in. `fences` and `values` hold `capacity` entries;
 * `out` receives initialized, fence count (which may exceed capacity: the extra fences are not
 * returned), Vulkan old layout, Vulkan new layout. */
WGPUStatus silkWebgpuSharedTextureMemoryEndAccess(WGPUSharedTextureMemory memory, WGPUTexture texture,
                                                  uint32_t useVkLayout, size_t capacity,
                                                  WGPUSharedFence *fences, uint64_t *values,
                                                  int32_t *out) {
    WGPUSharedTextureMemoryVkImageLayoutEndState layout = WGPU_SHARED_TEXTURE_MEMORY_VK_IMAGE_LAYOUT_END_STATE_INIT;
    WGPUSharedTextureMemoryEndAccessState state = WGPU_SHARED_TEXTURE_MEMORY_END_ACCESS_STATE_INIT;
    state.nextInChain = useVkLayout ? &layout.chain : NULL;
    WGPUStatus status = wgpuSharedTextureMemoryEndAccess(memory, texture, &state);
    out[0] = state.initialized ? 1 : 0;
    out[1] = (int32_t)state.fenceCount;
    out[2] = layout.oldLayout;
    out[3] = layout.newLayout;
    for (size_t i = 0; i < state.fenceCount && i < capacity; i++) {
        wgpuSharedFenceAddRef(state.fences[i]);
        fences[i] = state.fences[i];
        values[i] = state.signaledValues != NULL ? state.signaledValues[i] : 0;
    }
    wgpuSharedTextureMemoryEndAccessStateFreeMembers(state);
    return status;
}

uint32_t silkWebgpuSharedTextureMemoryIsDeviceLost(WGPUSharedTextureMemory memory) {
    return wgpuSharedTextureMemoryIsDeviceLost(memory) ? 1 : 0;
}

void silkWebgpuSharedTextureMemoryAddRef(WGPUSharedTextureMemory memory) {
    wgpuSharedTextureMemoryAddRef(memory);
}

void silkWebgpuSharedTextureMemoryRelease(WGPUSharedTextureMemory memory) {
    wgpuSharedTextureMemoryRelease(memory);
}

static WGPUSharedFence silkImportFence(WGPUDevice device, WGPUChainedStruct *chain) {
    WGPUSharedFenceDescriptor descriptor = WGPU_SHARED_FENCE_DESCRIPTOR_INIT;
    descriptor.nextInChain = chain;
    return wgpuDeviceImportSharedFence(device, &descriptor);
}

WGPUSharedFence silkWebgpuImportSyncFdFence(WGPUDevice device, int32_t fd) {
    WGPUSharedFenceSyncFDDescriptor sync = WGPU_SHARED_FENCE_SYNC_FD_DESCRIPTOR_INIT;
    sync.handle = fd;
    return silkImportFence(device, &sync.chain);
}

WGPUSharedFence silkWebgpuImportVkSemaphoreOpaqueFdFence(WGPUDevice device, int32_t fd) {
    WGPUSharedFenceVkSemaphoreOpaqueFDDescriptor semaphore = WGPU_SHARED_FENCE_VK_SEMAPHORE_OPAQUE_FD_DESCRIPTOR_INIT;
    semaphore.handle = fd;
    return silkImportFence(device, &semaphore.chain);
}

WGPUSharedFence silkWebgpuImportMtlSharedEventFence(WGPUDevice device, void *event) {
    WGPUSharedFenceMTLSharedEventDescriptor shared = WGPU_SHARED_FENCE_MTL_SHARED_EVENT_DESCRIPTOR_INIT;
    shared.sharedEvent = event;
    return silkImportFence(device, &shared.chain);
}

WGPUSharedFence silkWebgpuImportDxgiSharedHandleFence(WGPUDevice device, void *handle) {
    WGPUSharedFenceDXGISharedHandleDescriptor shared = WGPU_SHARED_FENCE_DXGI_SHARED_HANDLE_DESCRIPTOR_INIT;
    shared.handle = handle;
    return silkImportFence(device, &shared.chain);
}

/* The fence's type, and its handle: a file descriptor in *fd for the FD types, a pointer in
 * *handle for the others. Handles stay owned by the fence. */
uint32_t silkWebgpuSharedFenceExport(WGPUSharedFence fence, int32_t *fd, void **handle) {
    WGPUSharedFenceSyncFDExportInfo sync = WGPU_SHARED_FENCE_SYNC_FD_EXPORT_INFO_INIT;
    WGPUSharedFenceExportInfo info = WGPU_SHARED_FENCE_EXPORT_INFO_INIT;
    info.nextInChain = &sync.chain;
    wgpuSharedFenceExportInfo(fence, &info);
    *fd = -1;
    *handle = NULL;
    switch (info.type) {
    case WGPUSharedFenceType_SyncFD:
        break;
    case WGPUSharedFenceType_VkSemaphoreOpaqueFD: {
        WGPUSharedFenceVkSemaphoreOpaqueFDExportInfo opaque = WGPU_SHARED_FENCE_VK_SEMAPHORE_OPAQUE_FD_EXPORT_INFO_INIT;
        info.nextInChain = &opaque.chain;
        wgpuSharedFenceExportInfo(fence, &info);
        *fd = opaque.handle;
        return (uint32_t)info.type;
    }
    case WGPUSharedFenceType_MTLSharedEvent: {
        WGPUSharedFenceMTLSharedEventExportInfo event = WGPU_SHARED_FENCE_MTL_SHARED_EVENT_EXPORT_INFO_INIT;
        info.nextInChain = &event.chain;
        wgpuSharedFenceExportInfo(fence, &info);
        *handle = event.sharedEvent;
        return (uint32_t)info.type;
    }
    case WGPUSharedFenceType_DXGISharedHandle: {
        WGPUSharedFenceDXGISharedHandleExportInfo shared = WGPU_SHARED_FENCE_DXGI_SHARED_HANDLE_EXPORT_INFO_INIT;
        info.nextInChain = &shared.chain;
        wgpuSharedFenceExportInfo(fence, &info);
        *handle = shared.handle;
        return (uint32_t)info.type;
    }
    default:
        return (uint32_t)info.type;
    }
    *fd = sync.handle;
    return (uint32_t)info.type;
}

void silkWebgpuSharedFenceAddRef(WGPUSharedFence fence) {
    wgpuSharedFenceAddRef(fence);
}

void silkWebgpuSharedFenceRelease(WGPUSharedFence fence) {
    wgpuSharedFenceRelease(fence);
}
