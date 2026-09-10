/* ═══════════════════════════════════════════════════════════
   FIREBASE CONFIG — paste your own project credentials here.
   Firebase Console → Project Settings → Your apps → Web app
   ═══════════════════════════════════════════════════════════ */
const firebaseConfig = {
  apiKey: "AIzaSyCzbd_3E0QIUwIiGMhIFWKaBlenpxCLG1U",
  authDomain: "portfolio-7e824.firebaseapp.com",
  databaseURL: "https://portfolio-7e824-default-rtdb.firebaseio.com",
  projectId: "portfolio-7e824",
  storageBucket: "portfolio-7e824.firebasestorage.app",
  messagingSenderId: "1000863098146",
  appId: "1:1000863098146:web:59462964c7cd3e0abeb17b",
  measurementId: "G-K1LBSW63V8"
};

firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();
