// Firestore書き込み前にundefined値を除去するヘルパー
export const sanitizeData = (data: any): Record<string, any> => {
    const clean: Record<string, any> = {};
    Object.keys(data).forEach(key => {
        if (data[key] !== undefined) {
            clean[key] = data[key];
        }
    });
    return clean;
};
