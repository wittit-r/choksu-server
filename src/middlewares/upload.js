import multer from "multer";

const storage = multer.memoryStorage();
const upload = multer({
    storage,
    limits: { fileSize: 10 * 1024 * 1024 },
});

export const uploadSingle = upload.single("file");
export const uploadMultiple = upload.array("files", 5);
export const uploadFields = upload.fields([
    { name: "avatar", maxCount: 1 },
    { name: "documents", maxCount: 5 },
]);