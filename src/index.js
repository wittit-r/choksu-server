import "dotenv/config";
import express from "express";
import cors from "cors";
// import errorException from "./middlewares/errorException.js";
import { errorHandler } from "./middlewares/errorHandler.js";
import routes from "./routes/index.js";

const app = express();

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(cors({
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
}));

// Default routes
const startedAt = new Date();
app.get("/", (req, res) => {
    res.status(200).send({
        status: "ok",
        startedAt: startedAt,
        service: "choksu-backend",
    });
});

// Routes
app.use("/", routes);

// Global error exception
// app.use(errorException);
app.use(errorHandler);

const port = process.env.PORT || 9500;
app.listen(port, () => {
    console.log(`Server is running on port ${port}`);
});