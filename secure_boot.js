
/**
 * SL-FLIX PRO SECURITY LAYER
 * Protected Runtime Environment
 * (c) OmegaTech 2024
 */

(function() {
    'use strict';

    // 1. Disable Context Menu
    document.addEventListener('contextmenu', function(e) {
        // e.preventDefault(); // Commented out for easier debugging during development
    }, false);

    // 2. Disable Common DevTools Shortcuts
    document.addEventListener('keydown', function(e) {
        // Shortcuts are allowed during development/debugging
        return true;
    }, false);

    // 3. Console Clearing - DISABLED FOR DEBUGGING
    /*
    setInterval(function() {
        console.clear();
        console.log("%c SYSTEM SECURE ", "color: #00e5ff; font-size: 20px; font-weight: bold;");
    }, 2000);
    */

    console.log("Security Layer initialized in DEBUG mode.");

})();
