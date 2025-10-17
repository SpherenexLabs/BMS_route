// src/services/firebase.js
import { initializeApp } from "firebase/app";
import { getDatabase } from "firebase/database";

const firebaseConfig = {
  apiKey: "AIzaSyBi4imuMT5imCT-8IBULdyFqj-ZZtl68Do",
  authDomain: "regal-welder-453313-d6.firebaseapp.com",
  databaseURL: "https://regal-welder-453313-d6-default-rtdb.firebaseio.com",
  projectId: "regal-welder-453313-d6",
  storageBucket: "regal-welder-453313-d6.firebasestorage.app",
  messagingSenderId: "981360128010",
  appId: "1:981360128010:web:5176a72c013f26b8dbeff3",
  measurementId: "G-T67CCEJ8LW"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
export const db = getDatabase(app);
