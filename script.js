function openApp(appId) {
    const appWindow = document.getElementById(appId);
    const taskbarButton = document.querySelector(`#open-apps button\[data-appid="${appId}"]`);
   
    appWindow.classList.add('active');
    taskbarButton.style.display = 'block';
    taskbarButton.classList.add('active');
    bringToFront(appId);
   }
   
   function closeApp(appId) {
    const appWindow = document.getElementById(appId);
    const taskbarButton = document.querySelector(`#open-apps button\[data-appid="${appId}"]`);
   
    appWindow.classList.remove('active');
    taskbarButton.style.display = 'none';
    taskbarButton.classList.remove('active');
   }
   
   function focusApp(appId) {
    const appWindows = document.querySelectorAll('.app-window');
    const taskbarButtons = document.querySelectorAll('#open-apps .taskbar-button');
    const appWindow = document.getElementById(appId);
    const taskbarButton = document.querySelector(`#open-apps button\[data-appid="${appId}"]`);
   
    appWindows.forEach(win => win.classList.remove('active'));
    taskbarButtons.forEach(btn => btn.classList.remove('active'));
   
    appWindow.classList.add('active');
    taskbarButton.classList.add('active');
    bringToFront(appId);
   }
   
   function bringToFront(appId) {
    const appWindow = document.getElementById(appId);
    const allApps = document.querySelectorAll('.app-window');
    allApps.forEach(app => {
     app.style.zIndex = 1;
    });
    appWindow.style.zIndex = 10;
   }
   
   // Basic drag functionality (add to script.js)
   let activeWindow = null;
   let offsetX, offsetY;
   
   document.addEventListener('mousedown', (e) => {
    if (e.target.classList.contains('title-bar')) {
     activeWindow = e.target.parentNode;
     offsetX = e.clientX - activeWindow.getBoundingClientRect().left;
     offsetY = e.clientY - activeWindow.getBoundingClientRect().top;
     activeWindow.style.cursor = 'grabbing';
    } else {
     activeWindow = null;
    }
   });
   
   document.addEventListener('mousemove', (e) => {
    if (activeWindow) {
     activeWindow.style.left = e.clientX - offsetX + 'px';
     activeWindow.style.top = e.clientY - offsetY + 'px';
    }
   });
   
   document.addEventListener('mouseup', () => {
    if (activeWindow) {
     activeWindow.style.cursor = 'grab';
     activeWindow = null;
    }
   });