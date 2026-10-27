let uid = null;
export function setTestUser(next) { uid = next; }
export function getAuth() { return { currentUser: uid ? { uid } : null }; }
export function onAuthStateChanged() { return () => {}; }
