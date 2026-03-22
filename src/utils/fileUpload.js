import { S3Client, PutObjectCommand, DeleteObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

// Cloudflare R2 Client configuration
const r2Client = new S3Client({
    region: "auto",
    endpoint: process.env.R2_ENDPOINT,
    credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    },
});

const BUCKET_NAME = process.env.R2_BUCKET_NAME;
const PUBLIC_URL = process.env.R2_PUBLIC_URL;

/**
 * อัปโหลดไฟล์ไป Cloudflare R2
 * @param {Object} file - File object จาก multer
 * @param {string} folder - Folder path บน R2 (เช่น "timesheets/2024/02")
 * @returns {Promise<string>} R2 key ของไฟล์ที่อัปโหลด
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

    return key;
}

/**
 * ลบไฟล์จาก Cloudflare R2
 * @param {string} key - R2 key ของไฟล์ (เช่น "folder/file.pdf")
 * @returns {Promise<void>}
 */
export async function deleteFromR2(key) {
    const command = new DeleteObjectCommand({
        Bucket: BUCKET_NAME,
        Key: key,
    });

    await r2Client.send(command);
}

/**
 * สร้าง signed URL สำหรับดาวน์โหลดไฟล์
 * @param {string} key - R2 key ของไฟล์
 * @param {number} expiresIn - เวลาหมดอายุในวินาที (default: 3600 = 1 ชั่วโมง)
 * @returns {Promise<string>} Signed URL
 */
export async function generateSignedUrl(key, expiresIn = 3600) {
    const command = new GetObjectCommand({
        Bucket: BUCKET_NAME,
        Key: key,
    });

    return getSignedUrl(r2Client, command, { expiresIn });
}

/**
 * แปลง R2 key เป็น public URL (ถ้ามี custom domain หรือ public bucket)
 * @param {string} key - R2 key ของไฟล์
 * @returns {string} Public URL
 */
export function getPublicUrl(key) {
    if (!PUBLIC_URL) {
        throw new Error("R2_PUBLIC_URL is not configured");
    }
    return `${PUBLIC_URL}/${key}`;
}

export default {
    uploadToR2,
    deleteFromR2,
    generateSignedUrl,
    getPublicUrl,
};
