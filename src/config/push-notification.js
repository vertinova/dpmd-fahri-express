const webpush = require('web-push');

// VAPID keys untuk Web Push
const vapidKeys = {
  publicKey: process.env.VAPID_PUBLIC_KEY || 'BCEEJBfb05GAzlnpuzfPJszt054iCSOhqPVkmAMyTcUGZ8VrNluqShCQ2PVmwcMU0WuXJC35P5_XCXJNaQczX-U',
  privateKey: process.env.VAPID_PRIVATE_KEY || 'R9vEurYnCrkAYVmJS2q8YOZRZSymCZS2MF1nh7oMEyg'
};

// Setup web-push dengan VAPID details
webpush.setVapidDetails(
  'mailto:admin@dpmd.bogorkab.go.id',
  vapidKeys.publicKey,
  vapidKeys.privateKey
);

module.exports = {
  webpush,
  vapidKeys
};
