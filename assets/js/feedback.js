/**
 * Feedback form functionality
 */

class FeedbackForm {
  constructor() {
    this.form = document.getElementById('feedbackForm');
    this.initializeEventListeners();
  }

  initializeEventListeners() {
    const feedbackTypeSelect = document.getElementById('feedbackType');
    const platformSelect = document.getElementById('platform');
    const followUpSelect = document.getElementById('followUp');
    const desktopBrowserSelect = document.getElementById('desktopBrowser');
    const mobileBrowserSelect = document.getElementById('mobileBrowser');

    feedbackTypeSelect.addEventListener('change', () => this.handleFeedbackTypeChange());
    platformSelect.addEventListener('change', () => this.handlePlatformChange());
    followUpSelect.addEventListener('change', () => this.handleFollowUpChange());
    desktopBrowserSelect.addEventListener('change', () => this.handleBrowserChange('desktop'));
    mobileBrowserSelect.addEventListener('change', () => this.handleBrowserChange('mobile'));

    this.form.addEventListener('submit', e => this.handleSubmit(e));
  }

  handleFeedbackTypeChange() {
    const feedbackType = document.getElementById('feedbackType').value;
    const bugDetails = document.getElementById('bugDetails');

    if (feedbackType === 'bug') {
      bugDetails.style.display = 'block';
      this.setRequiredFields(bugDetails, true);
    } else {
      bugDetails.style.display = 'none';
      this.setRequiredFields(bugDetails, false);
      this.resetPlatformFields();
    }
  }

  handlePlatformChange() {
    const platform = document.getElementById('platform').value;
    const desktopDetails = document.getElementById('desktopDetails');
    const mobileDetails = document.getElementById('mobileDetails');

    if (platform === 'desktop') {
      desktopDetails.style.display = 'block';
      mobileDetails.style.display = 'none';
      this.setRequiredFields(desktopDetails, true);
      this.setRequiredFields(mobileDetails, false);
    } else if (platform === 'mobile') {
      mobileDetails.style.display = 'block';
      desktopDetails.style.display = 'none';
      this.setRequiredFields(mobileDetails, true);
      this.setRequiredFields(desktopDetails, false);
    } else {
      desktopDetails.style.display = 'none';
      mobileDetails.style.display = 'none';
      this.setRequiredFields(desktopDetails, false);
      this.setRequiredFields(mobileDetails, false);
    }
  }

  handleFollowUpChange() {
    const followUp = document.getElementById('followUp').value;
    const contactDetails = document.getElementById('contactDetails');

    if (followUp === 'yes') {
      contactDetails.style.display = 'block';
      this.setRequiredFields(contactDetails, true);
    } else {
      contactDetails.style.display = 'none';
      this.setRequiredFields(contactDetails, false);
    }
  }

  handleBrowserChange(platform) {
    const browserSelect = document.getElementById(`${platform}Browser`);
    const otherBrowserDiv = document.getElementById(`other${platform.charAt(0).toUpperCase() + platform.slice(1)}Browser`);

    if (browserSelect.value === 'other') {
      otherBrowserDiv.style.display = 'block';
      const otherInput = otherBrowserDiv.querySelector('input');
      if (otherInput) {otherInput.required = true;}
    } else {
      otherBrowserDiv.style.display = 'none';
      const otherInput = otherBrowserDiv.querySelector('input');
      if (otherInput) {
        otherInput.required = false;
        otherInput.value = '';
      }
    }
  }

  setRequiredFields(container, required) {
    const selects = container.querySelectorAll('select');
    const inputs = container.querySelectorAll('input');

    selects.forEach(select => {
      select.required = required;
      if (!required) {select.value = '';}
    });

    inputs.forEach(input => {
      if (!input.closest('.form-group[style*="display: none"]')) {
        input.required = required;
        if (!required) {input.value = '';}
      }
    });
  }

  resetPlatformFields() {
    document.getElementById('platform').value = '';
    document.getElementById('desktopDetails').style.display = 'none';
    document.getElementById('mobileDetails').style.display = 'none';
    this.setRequiredFields(document.getElementById('desktopDetails'), false);
    this.setRequiredFields(document.getElementById('mobileDetails'), false);
  }

  collectFormData() {
    const formData = new FormData(this.form);
    const data = {};

    for (const [key, value] of formData.entries()) {
      if (value.trim()) {
        data[key] = value.trim();
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
    const status = document.getElementById('submitStatus');
    status.textContent = message;
    status.className = `status-message ${isError ? 'error' : 'success'}`;
    status.style.display = 'block';

    setTimeout(() => {
      status.style.display = 'none';
    }, 5000);
  }

  async handleSubmit(e) {
    e.preventDefault();

    const submitButton = this.form.querySelector('.submit-button');
    const originalText = submitButton.textContent;

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
        console.error('Server response:', errorData);
        throw new Error(`Server error: ${response.status} - ${errorData}`);
      }
    } catch (error) {
      console.error('Submission error:', error);
      this.showStatus('Sorry, there was an error submitting your feedback. Please try again later.', true);
    } finally {
      submitButton.disabled = false;
      submitButton.textContent = originalText;
    }
  }
}

document.addEventListener('DOMContentLoaded', () => {
  new FeedbackForm();
});
