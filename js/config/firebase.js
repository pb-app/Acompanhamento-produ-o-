// Importa as funções oficiais do Firebase
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.4.0/firebase-app.js";
import { getFirestore, collection } from "https://www.gstatic.com/firebasejs/12.4.0/firebase-firestore.js";

// Sua configuração (copiada do seu arquivo original)
const firebaseConfig = {
    apiKey: "AIzaSyB2z4mFj5qVtb59uocKK8JXhMTfi8MGSTo",
    authDomain: "acompanhamento-de-produc-b68b0.firebaseapp.com",
    projectId: "acompanhamento-de-produc-b68b0",
    storageBucket: "acompanhamento-de-produc-b68b0.firebasestorage.app",
    messagingSenderId: "891709449679",
    appId: "1:891709449679:web:43e83e076f5fb3201e1eba"
};

// Inicializa o app e o banco de dados
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

// Exporta o banco de dados principal
export { db };

// Exporta as coleções JÁ PRONTAS para uso
// Assim você não precisa digitar collection(db, "nome") toda hora
// Exporta as coleções JÁ PRONTAS para uso
export const producoesCol = collection(db, "producoes");
export const operadoresCol = collection(db, "operadores");
export const massaCol = collection(db, "producao_massa");
export const pesagemCol = collection(db, "pesagem_paletes");
// NOVA COLEÇÃO:
export const moagemCol = collection(db, "moagem");

console.log("Firebase configurado e exportado via Módulo!");
