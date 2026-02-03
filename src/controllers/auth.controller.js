import { validate, Joi } from "../utils/validate.js";
import err from "../utils/error.js";
import authService from "../services/auth.service.js";

class AuthController {
    /**
     * POST /api/auth/login
     * Body: { username, password }
     */
    login = async (req, res) => {
        console.log(req.body);
        // Validate input
        const body = validate(req.body, Joi.object({
            username: Joi.string().required().min(3).max(50),
            password: Joi.string().required().min(6)
        }));

        // Call service
        const result = await authService.login(body.username, body.password);

        // Send response
        res.status(200).json({
            status: "success",
            data: result
        });
    };

    /**
     * POST /api/auth/refresh
     * Body: { refreshToken }
     */
    refreshAccessToken = async (req, res) => {
        // Validate input
        const body = validate(req.body, Joi.object({
            refreshToken: Joi.string().required()
        }));

        // Call service
        const result = await authService.refreshAccessToken(body.refreshToken);

        // Send response
        res.status(200).json({
            status: "success",
            data: result
        });
    };

    /**
     * POST /api/auth/logout
     */
    logout = async (req, res) => {
        // Call service
        await authService.logout(req.accessToken);

        // Send response
        res.status(200).json({
            status: "success",
        });
    };
}

export default new AuthController();
