// Self-cleaning legacy registerSW.js stub for GitHub Pages main/docs deployment
(function () {
  var swPromise =
    typeof navigator !== 'undefined' && 'serviceWorker' in navigator
      ? navigator.serviceWorker
          .getRegistrations()
          .then(function (regs) {
            if (!regs || !regs.length) return false;
            return Promise.all(
              regs.map(function (reg) {
                return reg.unregister().catch(function () {
                  return false;
                });
              })
            ).then(function () {
              return true;
            });
          })
          .catch(function () {
            return false;
          })
      : Promise.resolve(false);

  var cachePromise =
    typeof caches !== 'undefined'
      ? caches
          .keys()
          .then(function (keys) {
            if (!keys || !keys.length) return false;
            return Promise.all(
              keys.map(function (k) {
                return caches.delete(k).catch(function () {
                  return false;
                });
              })
            ).then(function () {
              return true;
            });
          })
          .catch(function () {
            return false;
          })
      : Promise.resolve(false);

  Promise.all([swPromise, cachePromise]).then(function (results) {
    if (results[0] || results[1]) {
      try {
        if (!sessionStorage.getItem('getcgl_sw_cleaned_v2')) {
          sessionStorage.setItem('getcgl_sw_cleaned_v2', '1');
          window.location.reload();
        }
      } catch (e) {}
    }
  });
})();
