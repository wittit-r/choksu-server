import bcrypt from 'bcryptjs';

const SALT_ROUNDS = parseInt(process.env.BCRYPT_SALT_ROUNDS) || 10;

/**
 * Hash password
 * @param {String} password - Plain text password
 * @returns {Promise<String>} Hashed password
 */
const hashPassword = async (password) => {
    return await bcrypt.hash(password, SALT_ROUNDS);
};

/**
 * เปรียบเทียบ password กับ hash
 * @param {String} password - Plain text password
 * @param {String} hash - Hashed password
 * @returns {Promise<Boolean>} true ถ้าตรงกัน
 */
const comparePassword = async (password, hash) => {
    return await bcrypt.compare(password, hash);
};

export {
    hashPassword,
    comparePassword
};
