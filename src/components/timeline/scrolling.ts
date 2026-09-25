/** The nearest ancestor that scrolls vertically, or null when only the page scrolls. */
export function findScrollParent(element: HTMLElement | null): HTMLElement | null {
    let node = element?.parentElement ?? null;
    while (node) {
        const { overflowY } = getComputedStyle(node);
        if ((overflowY === 'auto' || overflowY === 'scroll') && node.scrollHeight > node.clientHeight) {
            return node;
        }
        node = node.parentElement;
    }
    return null;
}
