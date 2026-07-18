/**
 * Minimal DOM double for node-based unit tests of the Arcade Kit surfaces.
 *
 * The kit builds its UI imperatively and keeps direct element references, so
 * tests only need element creation, tree editing, attributes/classes/styles,
 * events, and focus — no selector engine and no HTML parsing. Elements are
 * duck-typed; tests cast the roots to `HTMLElement`/`Document` exactly like
 * the established renderer fakes in `src/scenes/home/home.test.ts`.
 */

export interface FakeRect {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

interface FakeEventInit {
  readonly [key: string]: unknown;
}

export interface FakeEvent {
  readonly type: string;
  defaultPrevented: boolean;
  preventDefault(): void;
  readonly [key: string]: unknown;
}

export class FakeClassList {
  private readonly names = new Set<string>();

  add(...tokens: string[]): void {
    for (const token of tokens) this.names.add(token);
  }

  remove(...tokens: string[]): void {
    for (const token of tokens) this.names.delete(token);
  }

  contains(token: string): boolean {
    return this.names.has(token);
  }

  toggle(token: string, force?: boolean): boolean {
    const next = force ?? !this.names.has(token);
    if (next) this.names.add(token);
    else this.names.delete(token);
    return next;
  }

  toString(): string {
    return [...this.names].join(" ");
  }
}

export class FakeStyle {
  private readonly properties = new Map<string, string>();
  display = "";
  width = "";
  height = "";
  background = "";

  setProperty(name: string, value: string): void {
    this.properties.set(name, value);
  }

  getPropertyValue(name: string): string {
    return this.properties.get(name) ?? "";
  }

  removeProperty(name: string): void {
    this.properties.delete(name);
  }
}

export class FakeElement {
  readonly tagName: string;
  readonly classList = new FakeClassList();
  readonly style = new FakeStyle();
  readonly childNodes: FakeElement[] = [];
  parentElement: FakeElement | null = null;
  textContent = "";
  hidden = false;
  type = "";
  id = "";
  private readonly attributes = new Map<string, string>();
  private readonly listeners = new Map<string, Set<(event: FakeEvent) => void>>();
  private rect: FakeRect = { left: 0, top: 0, width: 390, height: 844 };

  constructor(
    tagName: string,
    readonly ownerDocument: FakeDocument,
  ) {
    this.tagName = tagName.toUpperCase();
  }

  get className(): string {
    return this.classList.toString();
  }

  set className(value: string) {
    for (const token of this.className.split(" ").filter(Boolean)) this.classList.remove(token);
    for (const token of value.split(" ").filter(Boolean)) this.classList.add(token);
  }

  get children(): readonly FakeElement[] {
    return this.childNodes;
  }

  get childElementCount(): number {
    return this.childNodes.length;
  }

  get clientWidth(): number {
    return this.rect.width;
  }

  get clientHeight(): number {
    return this.rect.height;
  }

  setFakeRect(rect: FakeRect): void {
    this.rect = rect;
  }

  getBoundingClientRect(): FakeRect & { right: number; bottom: number } {
    return {
      ...this.rect,
      right: this.rect.left + this.rect.width,
      bottom: this.rect.top + this.rect.height,
    };
  }

  append(...elements: FakeElement[]): void {
    for (const element of elements) this.appendChild(element);
  }

  appendChild(element: FakeElement): FakeElement {
    element.parentElement?.removeChild(element);
    element.parentElement = this;
    this.childNodes.push(element);
    return element;
  }

  removeChild(element: FakeElement): FakeElement {
    const index = this.childNodes.indexOf(element);
    if (index >= 0) {
      this.childNodes.splice(index, 1);
      element.parentElement = null;
    }
    return element;
  }

  remove(): void {
    this.parentElement?.removeChild(this);
  }

  replaceChildren(...elements: FakeElement[]): void {
    for (const child of [...this.childNodes]) this.removeChild(child);
    this.append(...elements);
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
    if (name === "id") this.id = value;
  }

  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null;
  }

  removeAttribute(name: string): void {
    this.attributes.delete(name);
  }

  addEventListener(type: string, listener: (event: FakeEvent) => void): void {
    let set = this.listeners.get(type);
    if (!set) {
      set = new Set();
      this.listeners.set(type, set);
    }
    set.add(listener);
  }

  removeEventListener(type: string, listener: (event: FakeEvent) => void): void {
    this.listeners.get(type)?.delete(listener);
  }

  listenerCount(type?: string): number {
    if (type !== undefined) return this.listeners.get(type)?.size ?? 0;
    let total = 0;
    for (const set of this.listeners.values()) total += set.size;
    return total;
  }

  dispatchEvent(event: FakeEvent): boolean {
    for (const listener of [...(this.listeners.get(event.type) ?? [])]) listener(event);
    return !event.defaultPrevented;
  }

  dispatch(type: string, init: FakeEventInit = {}): FakeEvent {
    const event = createFakeEvent(type, init);
    this.dispatchEvent(event);
    return event;
  }

  focus(): void {
    this.ownerDocument.activeElement = this;
  }

  setPointerCapture(pointerId: number): void {
    void pointerId;
  }

  releasePointerCapture(pointerId: number): void {
    void pointerId;
  }
}

export function createFakeEvent(type: string, init: FakeEventInit = {}): FakeEvent {
  const event = {
    type,
    defaultPrevented: false,
    preventDefault(): void {
      event.defaultPrevented = true;
    },
    repeat: false,
    ...init,
  };
  return event;
}

type FrameCallback = (timestamp: number) => void;

export class FakeWindow {
  devicePixelRatio = 2;
  private readonly listeners = new Map<string, Set<(event: FakeEvent) => void>>();
  private readonly frameQueue = new Map<number, FrameCallback>();
  private nextFrameHandle = 1;
  private frameTimestamp = 0;

  addEventListener(type: string, listener: (event: FakeEvent) => void): void {
    let set = this.listeners.get(type);
    if (!set) {
      set = new Set();
      this.listeners.set(type, set);
    }
    set.add(listener);
  }

  removeEventListener(type: string, listener: (event: FakeEvent) => void): void {
    this.listeners.get(type)?.delete(listener);
  }

  listenerCount(type?: string): number {
    if (type !== undefined) return this.listeners.get(type)?.size ?? 0;
    let total = 0;
    for (const set of this.listeners.values()) total += set.size;
    return total;
  }

  dispatch(type: string, init: FakeEventInit = {}): void {
    const event = createFakeEvent(type, init);
    for (const listener of [...(this.listeners.get(type) ?? [])]) listener(event);
  }

  requestAnimationFrame(callback: FrameCallback): number {
    const handle = this.nextFrameHandle;
    this.nextFrameHandle += 1;
    this.frameQueue.set(handle, callback);
    return handle;
  }

  cancelAnimationFrame(handle: number): void {
    this.frameQueue.delete(handle);
  }

  get pendingFrameCount(): number {
    return this.frameQueue.size;
  }

  /** Runs every queued frame callback once (callbacks may re-queue). */
  flushFrames(): number {
    const batch = [...this.frameQueue.entries()];
    this.frameQueue.clear();
    this.frameTimestamp += 1;
    for (const [, callback] of batch) callback(this.frameTimestamp);
    return batch.length;
  }
}

export class FakeDocument {
  readonly head: FakeElement;
  readonly body: FakeElement;
  readonly documentElement: FakeElement;
  activeElement: FakeElement | null = null;
  visibilityState: "visible" | "hidden" = "visible";
  readonly defaultView: FakeWindow;
  private readonly documentListeners = new Map<string, Set<(event: FakeEvent) => void>>();

  constructor(view: FakeWindow = new FakeWindow()) {
    this.defaultView = view;
    this.documentElement = new FakeElement("html", this);
    this.head = new FakeElement("head", this);
    this.body = new FakeElement("body", this);
    this.documentElement.append(this.head);
    this.documentElement.append(this.body);
  }

  createElement(tagName: string): FakeElement {
    return new FakeElement(tagName, this);
  }

  getElementById(id: string): FakeElement | null {
    const search = (element: FakeElement): FakeElement | null => {
      if (element.id === id) return element;
      for (const child of element.childNodes) {
        const found = search(child);
        if (found) return found;
      }
      return null;
    };
    return search(this.documentElement);
  }

  addEventListener(type: string, listener: (event: FakeEvent) => void): void {
    let set = this.documentListeners.get(type);
    if (!set) {
      set = new Set();
      this.documentListeners.set(type, set);
    }
    set.add(listener);
  }

  removeEventListener(type: string, listener: (event: FakeEvent) => void): void {
    this.documentListeners.get(type)?.delete(listener);
  }

  listenerCount(type?: string): number {
    if (type !== undefined) return this.documentListeners.get(type)?.size ?? 0;
    let total = 0;
    for (const set of this.documentListeners.values()) total += set.size;
    return total;
  }

  dispatch(type: string, init: FakeEventInit = {}): void {
    const event = createFakeEvent(type, init);
    for (const listener of [...(this.documentListeners.get(type) ?? [])]) listener(event);
  }
}

/** Creates a document plus a host element already attached to its body. */
export function createFakeDomHost(): {
  readonly document: FakeDocument;
  readonly window: FakeWindow;
  readonly host: FakeElement;
  readonly asHtmlElement: (element: FakeElement) => HTMLElement;
} {
  const window = new FakeWindow();
  const document = new FakeDocument(window);
  const host = document.createElement("section");
  document.body.append(host);
  return {
    document,
    window,
    host,
    asHtmlElement: (element) => element as unknown as HTMLElement,
  };
}
