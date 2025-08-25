/**
 * CloudFlare Pages function for handling feedback form submissions
 * Processes feedback and sends emails via Mailgun
 */

export async function onRequestPost({ request, env }) {
  try {
    const feedbackData = await request.json();
    
    // Validate required fields
    if (!feedbackData.feedbackType || !feedbackData.feedbackText) {
      return new Response(JSON.stringify({ error: 'Missing required fields' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Determine recipient email based on feedback type
    const recipient = feedbackData.feedbackType === 'bug' 
      ? 'bugs@ciphermaniac.com' 
      : 'features@ciphermaniac.com';

    // Build email content
    const emailContent = buildEmailContent(feedbackData);
    
    // Send email via Mailgun
    const mailgunResponse = await sendEmail(env, recipient, emailContent, feedbackData);
    
    if (!mailgunResponse.ok) {
      throw new Error(`Mailgun API error: ${mailgunResponse.status}`);
    }

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { 
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      }
    });

  } catch (error) {
    console.error('Feedback submission error:', error);
    
    return new Response(JSON.stringify({ 
      error: 'Internal server error',
      message: error.message 
    }), {
      status: 500,
      headers: { 
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      }
    });
  }
}

// Handle preflight requests
export async function onRequestOptions() {
  return new Response(null, {
    status: 200,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    }
  });
}

function buildEmailContent(data) {
  const lines = [
    `New ${data.feedbackType} submission from Ciphermaniac`,
    '',
    `Feedback Type: ${data.feedbackType}`,
    ''
  ];

  if (data.feedbackType === 'bug') {
    lines.push('Technical Details:');
    if (data.platform) {
      lines.push(`Platform: ${data.platform}`);
      
      if (data.platform === 'desktop') {
        if (data.desktopOS) lines.push(`OS: ${data.desktopOS}`);
        if (data.desktopBrowser) lines.push(`Browser: ${data.desktopBrowser}`);
      } else if (data.platform === 'mobile') {
        if (data.mobileOS) lines.push(`Mobile OS: ${data.mobileOS}`);
        if (data.mobileBrowser) lines.push(`Browser: ${data.mobileBrowser}`);
      }
    }
    lines.push('');
  }

  lines.push('Feedback:');
  lines.push(data.feedbackText);
  lines.push('');

  if (data.followUp === 'yes' && data.contactMethod && data.contactInfo) {
    lines.push('Contact Information:');
    lines.push(`Method: ${data.contactMethod}`);
    lines.push(`Contact: ${data.contactInfo}`);
  } else {
    lines.push('No follow-up requested');
  }

  lines.push('');
  lines.push(`Submitted at: ${new Date().toISOString()}`);

  return lines.join('\n');
}

async function sendEmail(env, recipient, content, feedbackData) {
  const mailgunDomain = env.MAILGUN_DOMAIN || 'ciphermaniac.com';
  const mailgunApiKey = env.MAILGUN_API_KEY;
  
  if (!mailgunApiKey) {
    throw new Error('MAILGUN_API_KEY environment variable not set');
  }

  const subject = `[Ciphermaniac] ${feedbackData.feedbackType === 'bug' ? 'Bug Report' : 'Feature Request'}`;
  
  const formData = new FormData();
  formData.append('from', `Ciphermaniac Feedback <noreply@${mailgunDomain}>`);
  formData.append('to', recipient);
  formData.append('subject', subject);
  formData.append('text', content);

  return fetch(`https://api.mailgun.net/v3/${mailgunDomain}/messages`, {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${btoa(`api:${mailgunApiKey}`)}`
    },
    body: formData
  });
}