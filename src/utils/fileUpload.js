import { S3Client, PutObjectCommand, DeleteObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

// Cloudflare R2 Client configuration
const r2Client = new S3Client({
    region: "auto",
    endpoint: process.env.R2_ENDPOINT, // เช่น https://<account_id>.r2.cloudflarestorage.com
    credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    },
});

const BUCKET_NAME = process.env.R2_BUCKET_NAME || "choksu-uploads";
const PUBLIC_URL = process.env.R2_PUBLIC_URL; // Custom domain หรือ R2 dev bucket URL

/**
 * อัปโหลดไฟล์ไป Cloudflare R2
 * @param {Object} file - File object จาก multer
 * @param {string} folder - Folder path บน R2 (เช่น "timesheets/2024/02")
 * @returns {Promise<string>} R2 path ของไฟล์ที่อัปโหลด
 */
export async function uploadToR2(file, folder = "uploads") {
    const fileName = `${Date.now()}-${file.originalname}`;
    const key = `${folder}/${fileName}`;

    const command = new PutObjectCommand({
        Bucket: BUCKET_NAME,
        Key: key,
        Body: file.buffer,
        ContentType: file.mimetype,
    });

    await r2Client.send(command);

    return `r2://${BUCKET_NAME}/${key}`;
}

/**
 * ลบไฟล์จาก Cloudflare R2
 * @param {string} filePath - R2 path ของไฟล์ (เช่น "r2://bucket/folder/file.pdf")
 * @returns {Promise<void>}
 */
export async function deleteFromR2(filePath) {
    // Extract key from R2 path
    const key = filePath.replace(`r2://${BUCKET_NAME}/`, "");

    const command = new DeleteObjectCommand({
        Bucket: BUCKET_NAME,
        Key: key,
    });

    await r2Client.send(command);
}

/**
 * สร้าง signed URL สำหรับดาวน์โหลดไฟล์
 * @param {string} filePath - R2 path ของไฟล์
 * @param {number} expiresIn - เวลาหมดอายุในวินาที (default: 3600 = 1 ชั่วโมง)
 * @returns {Promise<string>} Signed URL
 */
export async function generateSignedUrl(filePath, expiresIn = 3600) {
    // Extract key from R2 path
    const key = filePath.replace(`r2://${BUCKET_NAME}/`, "");

    const command = new GetObjectCommand({
        Bucket: BUCKET_NAME,
        Key: key,
    });

    return getSignedUrl(r2Client, command, { expiresIn });
}

/**
 * แปลง R2 path เป็น public URL (ถ้ามี custom domain หรือ public bucket)
 * @param {string} filePath - R2 path
 * @returns {string} Public URL
 */
export function getPublicUrl(filePath) {
    if (!PUBLIC_URL) {
        throw new Error("R2_PUBLIC_URL is not configured");
    }
    const key = filePath.replace(`r2://${BUCKET_NAME}/`, "");
    return `${PUBLIC_URL}/${key}`;
}

export default {
    uploadToR2,
    deleteFromR2,
    generateSignedUrl,
    getPublicUrl,
};
