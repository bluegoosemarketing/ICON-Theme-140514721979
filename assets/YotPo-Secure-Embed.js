document.addEventListener('DOMContentLoaded', function() {
  var modal = document.getElementById('bf-early-access-modal');
  var openModalBtn = document.getElementById('bf-open-modal-btn');
  var closeModalBtn = document.getElementsByClassName('bf-close')[0];
  var formContent = document.getElementById('form-content');
  var thankYouMessage = document.getElementById('thank-you-message');

  // Open modal
  openModalBtn.onclick = function() {
    modal.style.display = 'block';
  };

  // Close modal
  closeModalBtn.onclick = function() {
    modal.style.display = 'none';
    resetModal();
  };

  // Close modal when clicking outside content
  window.onclick = function(event) {
    if (event.target === modal) {
      modal.style.display = 'none';
      resetModal();
    }
  };

  // Handle form submission
  document.getElementById('bf-early-access-form').addEventListener('submit', async function(e) {
    e.preventDefault();

    const name = e.target.name.value.trim();
    const email = e.target.email.value.trim();
    const phone = e.target.phone.value.trim();
    const consent = e.target.consent.checked;

    if (!name || !email || !phone || !consent) {
      alert('Please fill in all fields and provide consent.');
      return;
    }

    const formattedPhone = formatPhoneNumber(phone, '+1');
    if (!formattedPhone) {
      alert('Invalid phone number format. Please correct it.');
      return;
    }

    const yotpoData = {
      phone_number: formattedPhone,
      email,
      first_name: name,
      consent: 'subscribed',
      list_id: 8533267,
      source: 'Homepage Hero Sign Up'
    };

    const appKey = 'SYPf8JLu0vVWFK0rW9gwMFln362yh2xvyfzVeCS6';
    const secretKey = 'GUvDzB9a8jtdHD77SqX1wFSZqb6epurhyIxV9mLR';

    try {
      const response = await fetch(`https://api.yotpo.com/sms/subscribers?app_key=${appKey}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': secretKey
        },
        body: JSON.stringify(yotpoData)
      });

      const data = await response.json();

      if (response.ok && data.status?.code === 200) {
        formContent.style.display = 'none';
        thankYouMessage.style.display = 'block';
      } else {
        console.error('Yotpo API Error:', data);
        alert('Failed to subscribe. Please try again.');
      }
    } catch (error) {
      console.error('Request Failed:', error);
      alert('Failed to submit data. Check your connection or try again later.');
    }
  });

  // Utility function to reset modal
  function resetModal() {
    formContent.style.display = 'block';
    thankYouMessage.style.display = 'none';
    document.getElementById('bf-early-access-form').reset();
  }

  // Utility function to format phone numbers
  function formatPhoneNumber(phone, defaultCountryCode) {
    phone = phone.replace(/\D/g, '');
    if (phone.length === 10) return `${defaultCountryCode}${phone}`;
    if (phone.startsWith('1') && phone.length === 11) return `+${phone}`;
    return null;
  }
});
