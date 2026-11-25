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

function buildPostTargetUrl(data) {
  const postId = data && data.postId ? String(data.postId) : '';
  const commentId = data && data.commentId ? String(data.commentId) : '';
  if (!postId) return '/';
  const params = new URLSearchParams();
  params.set('post', postId);
  if (commentId) params.set('comment', commentId);
  return '/?' + params.toString();
}

messaging.onBackgroundMessage((payload) => {
  const data = (payload && payload.data) || {};
  const notif = (payload && payload.notification) || {};

  const title = notif.title || 'Ethio Chat';
  const body =
    notif.body ||
    data.body ||
    (data.fromUsername ? '@' + data.fromUsername + ' si @mention godhe' : 'New notification');

  const options = {
    body,
    icon: '/assets/aistudio/20261111_152710_57efcc53.png',
    badge: '/assets/aistudio/20261111_152710_57efcc53.png',
    data: {
      postId: data.postId || '',
      commentId: data.commentId || '',
      notificationId: data.notificationId || '',
      url: data.url || buildPostTargetUrl(data),
    },
    tag: data.commentId ? 'mention_' + data.commentId : data.postId ? 'post_' + data.postId : 'ethio_notif',
  };

  return self.registration.showNotification(title, options);
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const rawData = event.notification && event.notification.data ? event.notification.data : {};
  const fcmData = rawData.FCM_MSG && rawData.FCM_MSG.data ? rawData.FCM_MSG.data : {};
  const postId = String(rawData.postId || fcmData.postId || '');
  const commentId = String(rawData.commentId || fcmData.commentId || '');
  const targetPath = rawData.url || fcmData.url || buildPostTargetUrl({ postId, commentId });
  const targetUrl = new URL(targetPath, self.location.origin).href;

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ('focus' in client) {
          client.focus();
          client.postMessage({
            type: 'OPEN_MENTION_POST',
            postId,
            commentId,
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
