/* eslint-disable no-undef */
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const data = (event.notification && event.notification.data) || {};
  const targetPath = typeof data.url === 'string' && data.url ? data.url : '/';
  const targetUrl = new URL(targetPath, self.location.origin).href;

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ('focus' in client) {
          client.focus();
          client.postMessage({
            type: 'OPEN_ETHIO_NOTIFICATION',
            url: targetPath,
            callId: data.callId || '',
            chatId: data.chatId || '',
            postId: data.postId || '',
            commentId: data.commentId || '',
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
