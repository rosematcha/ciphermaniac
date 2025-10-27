import './utils/buildVersion.js';
import { logger } from './utils/logger.js';

/**
 * Feedback form functionality
 */

/**
 * @template {HTMLElement} T
 * @param {string} id
 * @param {new (...args: any[]) => T} Constructor
 * @returns {T}
 */
function getRequiredElement(id, Constructor) {
  const element = document.getElementById(id);
  if (!element || !(element instanceof Constructor)) {
    throw new Error(`Element with id "${id}" not found or not a ${Constructor.name}`);
  }
  return element;
}

/**
 * @param {HTMLElement} container
 * @param {boolean} required
 */
function setRequiredFields(container, required) {
  const selects = container.querySelectorAll('select');
  const inputs = container.querySelectorAll('input');

  selects.forEach(select => {
    // eslint-disable-next-line no-param-reassign
    select.required = required;
    // eslint-disable-next-line no-param-reassign
    if (!required) {select.value = '';}
  });

  inputs.forEach(input => {
    if (!input.closest('.form-group[style*="display: none"]')) {
      // eslint-disable-next-line no-param-reassign
      input.required = required;
      // eslint-disable-next-line no-param-reassign
      if (!required) {input.value = '';}
    }
  });
}

class FeedbackForm {
  /**
   * @param {HTMLFormElement} form
   */
  constructor(form) {
    /** @type {HTMLFormElement} */
    this.form = form;
    this.elements = {
      feedbackType: getRequiredElement('feedbackType', HTMLSelectElement),
      bugDetails: getRequiredElement('bugDetails', HTMLElement),
      platform: getRequiredElement('platform', HTMLSelectElement),
      desktopDetails: getRequiredElement('desktopDetails', HTMLElement),
      mobileDetails: getRequiredElement('mobileDetails', HTMLElement),
      followUp: getRequiredElement('followUp', HTMLSelectElement),
      contactDetails: getRequiredElement('contactDetails', HTMLElement),
      desktopBrowser: getRequiredElement('desktopBrowser', HTMLSelectElement),
      mobileBrowser: getRequiredElement('mobileBrowser', HTMLSelectElement),
      otherDesktopBrowser: getRequiredElement('otherDesktopBrowser', HTMLElement),
      otherMobileBrowser: getRequiredElement('otherMobileBrowser', HTMLElement),
      status: getRequiredElement('submitStatus', HTMLElement)
    };
    this.initializeEventListeners();
  }

  initializeEventListeners() {
    this.elements.feedbackType.addEventListener('change', () => this.handleFeedbackTypeChange());
    this.elements.platform.addEventListener('change', () => this.handlePlatformChange());
    this.elements.followUp.addEventListener('change', () => this.handleFollowUpChange());
    this.elements.desktopBrowser.addEventListener('change', () => this.handleBrowserChange('desktop'));
    this.elements.mobileBrowser.addEventListener('change', () => this.handleBrowserChange('mobile'));

    this.form.addEventListener('submit', event => this.handleSubmit(event));
  }

  handleFeedbackTypeChange() {
    const { feedbackType, bugDetails } = this.elements;
    const feedbackTextarea = document.getElementById('feedbackText');

    if (feedbackType.value === 'bug') {
      bugDetails.style.display = 'block';
      setRequiredFields(bugDetails, true);
      if (feedbackTextarea instanceof HTMLTextAreaElement) {
        feedbackTextarea.placeholder = 'Please describe your bug report or feature request in detail...';
      }
    } else if (feedbackType.value === 'love') {
      bugDetails.style.display = 'none';
      setRequiredFields(bugDetails, false);
      this.resetPlatformFields();
      if (feedbackTextarea instanceof HTMLTextAreaElement) {
        feedbackTextarea.placeholder = 'User-sama... I didn\'t know you felt that way...';
      }
    } else {
      bugDetails.style.display = 'none';
      setRequiredFields(bugDetails, false);
      this.resetPlatformFields();
      if (feedbackTextarea instanceof HTMLTextAreaElement) {
        feedbackTextarea.placeholder = 'Please describe your bug report or feature request in detail...';
      }
    }
  }

  handlePlatformChange() {
    const { platform, desktopDetails, mobileDetails } = this.elements;

    if (platform.value === 'desktop') {
      desktopDetails.style.display = 'block';
      mobileDetails.style.display = 'none';
      setRequiredFields(desktopDetails, true);
      setRequiredFields(mobileDetails, false);
    } else if (platform.value === 'mobile') {
      mobileDetails.style.display = 'block';
      desktopDetails.style.display = 'none';
      setRequiredFields(mobileDetails, true);
      setRequiredFields(desktopDetails, false);
    } else {
      desktopDetails.style.display = 'none';
      mobileDetails.style.display = 'none';
      setRequiredFields(desktopDetails, false);
      setRequiredFields(mobileDetails, false);
    }
  }

  handleFollowUpChange() {
    const { followUp, contactDetails } = this.elements;

    if (followUp.value === 'yes') {
      contactDetails.style.display = 'block';
      setRequiredFields(contactDetails, true);
    } else {
      contactDetails.style.display = 'none';
      setRequiredFields(contactDetails, false);
    }
  }

  handleBrowserChange(platform) {
    const browserSelect = this.elements[`${platform}Browser`];
    const otherBrowserDiv = this.elements[`other${platform.charAt(0).toUpperCase() + platform.slice(1)}Browser`];

    if (browserSelect.value === 'other') {
      otherBrowserDiv.style.display = 'block';
      const otherInput = otherBrowserDiv.querySelector('input');
      if (otherInput instanceof HTMLInputElement) {otherInput.required = true;}
    } else {
      otherBrowserDiv.style.display = 'none';
      const otherInput = otherBrowserDiv.querySelector('input');
      if (otherInput instanceof HTMLInputElement) {
        otherInput.required = false;
        otherInput.value = '';
      }
    }
  }

  resetPlatformFields() {
    const { platform, desktopDetails, mobileDetails } = this.elements;

    platform.value = '';
    desktopDetails.style.display = 'none';
    mobileDetails.style.display = 'none';
    setRequiredFields(desktopDetails, false);
    setRequiredFields(mobileDetails, false);
  }

  /**
   * @returns {Record<string, string>}
   */
  collectFormData() {
    const formData = new FormData(this.form);
    /** @type {Record<string, string>} */
    const data = {};

    for (const [key, value] of formData.entries()) {
      if (typeof value === 'string') {
        const trimmed = value.trim();
        if (trimmed) {
          data[key] = trimmed;
        }
      }
    }

    if (data.desktopBrowser === 'other' && data.otherDesktopBrowserName) {
      data.desktopBrowser = data.otherDesktopBrowserName;
      delete data.otherDesktopBrowserName;
    }

    if (data.mobileBrowser === 'other' && data.otherMobileBrowserName) {
      data.mobileBrowser = data.otherMobileBrowserName;
      delete data.otherMobileBrowserName;
    }

    return data;
  }

  showStatus(message, isError = false) {
    const { status } = this.elements;
    status.textContent = message;
    status.className = `status-message ${isError ? 'error' : 'success'}`;
    status.style.display = 'block';

    setTimeout(() => {
      status.style.display = 'none';
    }, 5000);
  }

  async handleSubmit(event) {
    event.preventDefault();

    const submitButton = this.form.querySelector('.submit-button');
    if (!(submitButton instanceof HTMLButtonElement)) {
      throw new Error('Submit button not found');
    }
    const { textContent: originalText } = submitButton;

    try {
      submitButton.disabled = true;
      submitButton.textContent = 'Submitting...';

      const formData = this.collectFormData();

      const response = await fetch('/api/feedback', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(formData)
      });

      if (response.ok) {
        this.showStatus('Thank you! Your feedback has been submitted successfully.');
        this.form.reset();
        this.handleFeedbackTypeChange();
        this.handleFollowUpChange();
      } else {
        const errorData = await response.text();
        logger.error('Feedback submission rejected by server', errorData);
        throw new Error(`Server error: ${response.status} - ${errorData}`);
      }
    } catch (error) {
      logger.error('Submission error', error);
      this.showStatus('Sorry, there was an error submitting your feedback. Please try again later.', true);
    } finally {
      submitButton.disabled = false;
      submitButton.textContent = originalText;
    }
  }
}

document.addEventListener('DOMContentLoaded', () => {
  const formElement = document.getElementById('feedbackForm');
  if (formElement instanceof HTMLFormElement) {
    // eslint-disable-next-line no-new
    new FeedbackForm(formElement);
  }
});
