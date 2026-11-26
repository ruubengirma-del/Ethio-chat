/* eslint-disable no-undef */
importScripts('https://www.gstatic.com/firebasejs/11.6.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/11.6.0/firebase-messaging-compat.js');

const firebaseConfig = {
  apiKey: 'AIzaSyAGKRaF1kHHdm-uy1uouvalaWDASV4ks0E',
  authDomain: 'polished-liberty-l4mm2.firebaseapp.com',
  projectId: 'polished-liberty-l4mm2',
  storageBucket: 'polished-liberty-l4mm2.firebasestorage.app',
  messagingSenderId: '916935473443',
  appId: '1:916935473443:web:a34d4b2b53a3cedfcb7496',
};

if (!firebase.apps.length) {
  firebase.initializeApp(firebaseConfig);
}

const messaging = firebase.messaging();

function buildTargetUrl(data) {
  if (data && data.url) return String(data.url);
  const callId = data && data.callId ? String(data.callId) : '';
  if (callId) return '/?call=' + encodeURIComponent(callId);
  const postId = data && data.postId ? String(data.postId) : '';
  const commentId = data && data.commentId ? String(data.commentId) : '';
  if (postId) {
    const params = new URLSearchParams();
    params.set('post', postId);
    if (commentId) params.set('comment', commentId);
    return '/?' + params.toString();
  }
  const chatId = data && data.chatId ? String(data.chatId) : '';
  if (chatId) return '/?chat=' + encodeURIComponent(chatId);
  return '/';
}

messaging.onBackgroundMessage((payload) => {
  const data = (payload && payload.data) || {};
  const notif = (payload && payload.notification) || {};

  const title = notif.title || data.title || 'Ethio Chat';
  const body =
    notif.body ||
    data.body ||
    (data.fromUsername ? '@' + data.fromUsername + ' mentioned you' : 'New notification');

  const targetUrl = buildTargetUrl(data);
  const options = {
    body,
    icon: '/assets/aistudio/20261111_152710_57efcc53.png',
    badge: '/assets/aistudio/20261111_152710_57efcc53.png',
    requireInteraction: data.type === 'call',
    vibrate: data.type === 'call' ? [300, 150, 300] : undefined,
    data: {
      postId: data.postId || '',
      commentId: data.commentId || '',
      chatId: data.chatId || '',
      callId: data.callId || '',
      notificationId: data.notificationId || '',
      url: targetUrl,
    },
    tag: data.callId
      ? 'call_' + data.callId
      : data.commentId
      ? 'comment_' + data.commentId
      : data.postId
      ? 'post_' + data.postId
      : data.chatId
      ? 'chat_' + data.chatId
      : 'ethio_notif',
  };

  return self.registration.showNotification(title, options);
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const rawData = event.notification && event.notification.data ? event.notification.data : {};
  const fcmData = rawData.FCM_MSG && rawData.FCM_MSG.data ? rawData.FCM_MSG.data : {};
  const postId = String(rawData.postId || fcmData.postId || '');
  const commentId = String(rawData.commentId || fcmData.commentId || '');
  const chatId = String(rawData.chatId || fcmData.chatId || '');
  const callId = String(rawData.callId || fcmData.callId || '');
  const targetPath = rawData.url || fcmData.url || buildTargetUrl({ postId, commentId, chatId, callId });
  const targetUrl = new URL(targetPath, self.location.origin).href;

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ('focus' in client) {
          client.focus();
          client.postMessage({
            type: 'OPEN_ETHIO_NOTIFICATION',
            url: targetPath,
            postId,
            commentId,
            chatId,
            callId,
          });
          return;
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow(targetUrl);
      }
      return undefined;
    })
  );
});
