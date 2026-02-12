// Firestoreエラーを適切にハンドリングするヘルパー（permission-deniedノイズを抑制）
export const handleFirestoreError = (error: any, context: string) => {
    if (error?.code === 'permission-denied') {
        console.warn(`Firestore permission denied (${context}): User might be logged out or deleted.`);
    } else {
        console.error(`Error fetching ${context}:`, error);
    }
};
