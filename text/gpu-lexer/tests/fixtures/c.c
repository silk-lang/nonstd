#include <stdio.h>
#include <stdlib.h>
#define SQUARE(x) ((x) * (x))

/* A singly linked list node. */
typedef struct node {
    int value;
    struct node *next;
} node_t;

static node_t *push(node_t *head, int value) {
    node_t *n = malloc(sizeof *n);
    if (!n) return head;
    n->value = value;
    n->next = head;
    return n;
}

int main(void) {
    node_t *list = NULL;
    for (int i = 0; i < 4; ++i) list = push(list, SQUARE(i));
    for (node_t *it = list; it; it = it->next) printf("%d\n", it->value);
    return 0;
}
