const formData = require('form-data');
const Mailgun = require('mailgun.js');
const mailgun = new Mailgun(formData);
const mg = mailgun.client({username: 'api', key: process.env.MAILGUN_API_KEY});

const sendOtp = async (email, otp, name) => {
  try {

    const data = {
        from: 'slotshare@mail.vishok.tech',
        to: email,
        subject: 'Verify Your SlotShare Account with One-Time Password (OTP)',
        template: 'otp',
        'h:X-Mailgun-Variables': JSON.stringify({otp: otp, name: name})
    };

    const response = await mg.messages.create('mail.vishok.tech', data);
    return response;
    } catch (error) {
    console.error(error);
    return error;
    }
}

const sendRSVP = async (name, email, event, d, s, description, venue, creator, eid) => {

  try {

    const data = {
        from: 'slotshare@mail.vishok.tech',
        to: email,
        subject: 'You have been invited to ' + event,
        template: 'rsvp',
        'h:X-Mailgun-Variables': JSON.stringify({name: name, event: event, d: d, s: s, description: description, venue: venue, creator: creator, id: eid})

    };

    const response = await mg.messages.create('mail.vishok.tech', data);
    return response;
  } catch (error) {
    console.error(error);
    return
  }
}

module.exports = sendOtp;
module.exports = sendRSVP;