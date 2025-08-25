# Firebase Setup Instructions

## 1. Firebase Project Setup
1. Go to [Firebase Console](https://console.firebase.google.com/)
2. Create a new project (or use existing)
3. Enable Authentication → Sign-in method → Google
4. Enable Firestore Database → Create in test mode
5. Get your config from Project Settings → General → Your apps

## 2. Update Firebase Config
Edit `assets/js/config/firebase.js` and replace the config object:

```javascript
const firebaseConfig = {
  apiKey: "your-actual-api-key",
  authDomain: "your-project.firebaseapp.com",
  projectId: "your-project-id",
  storageBucket: "your-project.appspot.com", 
  messagingSenderId: "123456789",
  appId: "your-app-id"
};
```

## 3. Add Firebase to HTML
Add these script tags to `index.html` and other HTML files before your existing scripts:

```html
<!-- Firebase SDK -->
<script src="https://www.gstatic.com/firebasejs/9.23.0/firebase-app-compat.js"></script>
<script src="https://www.gstatic.com/firebasejs/9.23.0/firebase-auth-compat.js"></script>
<script src="https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore-compat.js"></script>

<!-- Initialize Firebase before your app -->
<script type="module">
  import { initializeFirebase } from './assets/js/config/firebase.js';
  import { initAuth } from './assets/js/auth.js';
  
  // Initialize Firebase
  initializeFirebase();
  initAuth();
</script>
```

## 4. Add Login/Logout UI
Add authentication controls to your UI. Example:

```html
<div id="auth-controls">
  <button id="login-btn" style="display:none">Sign in with Google</button>
  <div id="user-info" style="display:none">
    <span id="user-name"></span>
    <button id="logout-btn">Sign out</button>
  </div>
</div>
```

```javascript
import { signInWithGoogle, signOut, subscribeAuth } from './assets/js/auth.js';
import { syncFavoritesOnLogin } from './assets/js/favorites.js';

// Wire up auth UI
document.getElementById('login-btn').onclick = () => signInWithGoogle();
document.getElementById('logout-btn').onclick = () => signOut();

// Listen for auth changes
subscribeAuth((user) => {
  const loginBtn = document.getElementById('login-btn');
  const userInfo = document.getElementById('user-info');
  const userName = document.getElementById('user-name');
  
  if (user) {
    loginBtn.style.display = 'none';
    userInfo.style.display = 'block';
    userName.textContent = user.displayName;
    
    // Sync favorites on login
    syncFavoritesOnLogin(user);
  } else {
    loginBtn.style.display = 'block';
    userInfo.style.display = 'none';
  }
});
```

## 5. Deploy to Firebase (Optional)
```bash
npm install -g firebase-tools
firebase login
firebase init
firebase deploy
```

## Features Added
- ✅ Google OAuth authentication
- ✅ Persistent favorites across devices
- ✅ Automatic sync between localStorage and Firestore
- ✅ Backward compatibility (works offline with localStorage)
- ✅ Secure Firestore rules (users can only access their own data)

## How It Works
1. **Offline/Anonymous**: Uses localStorage (existing behavior)
2. **Signed In**: Syncs favorites between localStorage and Firestore
3. **Login**: Merges localStorage favorites with cloud favorites
4. **Cross-device**: Favorites sync across all signed-in devices