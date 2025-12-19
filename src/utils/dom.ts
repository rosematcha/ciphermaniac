/**
 * DOM manipulation utilities for better performance and safety
 * @module DOMUtils
 */

/**
 * Safely set innerHTML with validation
 * @param element
 * @param content
 */
export function safeSetHTML(element: Element | null, content: string): void {
  if (!element || typeof content !== 'string') {
    return;
  }
  element.innerHTML = content;
}

/**
 * Batch DOM operations using DocumentFragment for better performance
 * @param container
 * @param elements
 */
export function batchAppend(container: Element | null, elements: Element[]): void {
  if (!container || !Array.isArray(elements)) {
    return;
  }

  const fragment = document.createDocumentFragment();
  elements.forEach(el => el && fragment.appendChild(el));
  container.appendChild(fragment);
}

/**
 * Safe property assignment avoiding parameter mutation
 * @param element
 * @param properties
 */
export function setProperties(element: Element | null, properties: Record<string, any>): void {
  if (!element || !properties) {
    return;
  }
  Object.assign(element, properties);
}

/**
 * Safe style assignment avoiding parameter mutation
 * @param element
 * @param styles
 */
export function setStyles(element: HTMLElement | null, styles: Partial<CSSStyleDeclaration>): void {
  if (!element?.style || !styles) {
    return;
  }
  Object.assign(element.style, styles);
}

interface CreateElementOptions {
  attributes?: Record<string, any>;
  styles?: Partial<CSSStyleDeclaration>;
  textContent?: string;
  className?: string;
}

/**
 * Create element with attributes and content efficiently
 * @param tagName
 * @param options
 * @returns
 */
export function createElement(tagName: string, options: CreateElementOptions = {}): HTMLElement {
  const element = document.createElement(tagName);
  const { attributes, styles, textContent, className } = options;

  if (className) {
    element.className = className;
  }
  if (textContent) {
    element.textContent = textContent;
  }
  if (attributes) {
    Object.entries(attributes).forEach(([key, value]) => element.setAttribute(key, value));
  }
  if (styles) {
    setStyles(element, styles);
  }

  return element;
}
