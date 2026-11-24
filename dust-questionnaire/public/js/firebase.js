// Loads the Firebase SDK from one place, so the version is pinned in one spot.
export { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
export {
  getFirestore, doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc, collection,
  writeBatch, serverTimestamp, runTransaction,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
