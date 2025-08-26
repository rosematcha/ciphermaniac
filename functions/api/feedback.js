/**
 * CloudFlare Pages function for handling feedback form submissions
 * Processes feedback and sends emails via Resend
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

    // Send all feedback to main email
    const recipient = 'reese@ciphermaniac.com';

    // Build email content
    const emailContent = buildEmailContent(feedbackData);
    
    // Send email via Resend
    const resendResponse = await sendEmail(env, recipient, emailContent, feedbackData);
    
    if (!resendResponse.ok) {
      const errorText = await resendResponse.text();
      console.error('Resend API Error Response:', errorText);
      throw new Error(`Resend API error: ${resendResponse.status} - ${errorText}`);
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
  const resendApiKey = env.RESEND_API_KEY;
  
  if (!resendApiKey) {
    throw new Error('RESEND_API_KEY environment variable not set');
  }

  const subject = `[Ciphermaniac] ${feedbackData.feedbackType === 'bug' ? 'Bug Report' : 'Feature Request'}`;
  
  const emailPayload = {
    from: 'Ciphermaniac Feedback <onboarding@resend.dev>',
    to: recipient,
    subject: subject,
    text: content
  };

  return fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${resendApiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(emailPayload)
  });
}