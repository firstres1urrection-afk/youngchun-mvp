self.addEventListener('push', function(event) {
  const data = event.data ? event.data.json() : {};
  const title = data.title || 'Youngchun';
  const options = {
    body: data.body || '',
  };
  event.waitUntil(self.registration.showNotification(title, options));
});
