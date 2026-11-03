// Dine service worker: shows meal reminders sent by the server (Web Push)
// and opens the app when one is tapped. It does not cache pages.

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data ? event.data.text() : "" };
  }
  event.waitUntil(
    self.registration.showNotification(data.title || "Dine", {
      body: data.body || "Please choose your meals.",
      // The Livoza logo beside the message (Android, computers). iPhones
      // always show the Home Screen icon instead.
      icon: "/icon-192.png",
      // The small status-bar icon on Android: a white silhouette of the logo
      // (Android shows only its shape, so a full-colour picture would be a blank square).
      badge: "/notification-badge.png",
      tag: "meal-reminder",
      data: { url: data.url || "/home" },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = new URL(event.notification.data?.url || "/home", self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((windows) => {
      for (const client of windows) {
        if (client.url.startsWith(self.location.origin) && "focus" in client) {
          client.navigate(url);
          return client.focus();
        }
      }
      return self.clients.openWindow(url);
    }),
  );
});
