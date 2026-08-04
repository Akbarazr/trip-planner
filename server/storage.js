const useFirestore = String(process.env.USE_FIRESTORE).toLowerCase() === 'true';

const { default: storage } = await import(
  useFirestore ? './storage/firestore.js' : './storage/sqlite.js'
);

export { useFirestore };
export default storage;
