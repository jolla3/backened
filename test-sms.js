const axios = require('axios');
const qs = require('qs');

async function testSMS() {
  try {
    console.log('🧪 Testing SMS...');
    
    const username = 'ithitu';
    const apiKey = 'atsk_1c928ed91a160e10052305fc71c5cedf34f5ab2b282409a273348dbdf7708108e3b40ca4';
    
    const url = `https://api.africastalking.com/version1/messaging?username=${username}`;
    const formData = qs.stringify({
      username,
      to: '254786834735',
      message: 'Direct test from Dairy Coop',
      from: 'sandbox'
    });

    console.log('📤 Sending to:', url);
    
    const response = await axios.post(url, formData, {
      headers: {
        'apiKey': apiKey,
        'Content-Type': 'application/x-www-form-urlencoded'
      }
    });

    console.log('✅ SMS SUCCESS:', response.data);
  } catch (error) {
    console.error('❌ SMS ERROR:');
    console.error('Status:', error.response?.status);
    console.error('Data:', error.response?.data);
    console.error('Full error:', error.message);
  }
}

testSMS();