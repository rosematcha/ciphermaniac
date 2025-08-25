/**
 * DOM manipulation utilities for better performance and safety
 * @module DOMUtils
 */

/**
 * Safely set innerHTML with validation
 * @param {Element} element
 * @param {string} content
 */
export function safeSetHTML(element, content) {
  if (!element || typeof content !== 'string') {
    return;
  }
  element.innerHTML = content;
}

/**
 * Batch DOM operations using DocumentFragment for better performance
 * @param {Element} container
 * @param {Element[]} elements
 */
export function batchAppend(container, elements) {
  if (!container || !Array.isArray(elements)) {
    return;
  }

  const fragment = document.createDocumentFragment();
  elements.forEach(el => el && fragment.appendChild(el));
  container.appendChild(fragment);
}

/**
 * Safe property assignment avoiding parameter mutation
 * @param {Element} element
 * @param {Object} properties
 */
export function setProperties(element, properties) {
  if (!element || !properties) {
    return;
  }
  Object.assign(element, properties);
}

/**
 * Safe style assignment avoiding parameter mutation
 * @param {Element} element
 * @param {Object} styles
 */
export function setStyles(element, styles) {
  if (!element?.style || !styles) {
    return;
  }
  Object.assign(element.style, styles);
}

/**
 * Create element with attributes and content efficiently
 * @param {string} tagName
 * @param {Object} options
 * @param {Object} options.attributes
 * @param {Object} options.styles
 * @param {string} options.textContent
 * @param {string} options.className
 * @returns {Element}
 */
export function createElement(tagName, { attributes, styles, textContent, className } = {}) {
  const element = document.createElement(tagName);

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
