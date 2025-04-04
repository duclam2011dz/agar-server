require("dotenv").config();
const express = require("express");
const app = express();
const http = require("http").createServer(app);
const io = require("socket.io")(http, {
    cors: {
        origin: "*"
    }
});
const mongoose = require("mongoose");
const bodyParser = require("body-parser");
const bcrypt = require("bcrypt");
const SALT_ROUNDS = 10;
const path = require("path");

app.use(express.static(path.join(__dirname, "public")));
app.use(bodyParser.json());

// ======== KẾT NỐI MONGO DB ========
mongoose.connect(process.env.MONGO_URI)
    .then(() => console.log("✅ MongoDB Atlas đã kết nối!"))
    .catch(err => console.error("❌ MongoDB connect lỗi:", err));

// ======== SCHEMA MONGO ========
const userSchema = new mongoose.Schema({
    username: String,
    password: String
});
const User = mongoose.model("User", userSchema);

const playerSchema = new mongoose.Schema({
    name: String,
    score: Number
});
const Player = mongoose.model("Player", playerSchema);

// ======== API ĐĂNG KÝ / LOGIN ========
app.post("/api/register", async (req, res) => {
    const { username, password } = req.body;

    if (!username || !password) {
        return res.status(400).json({ error: "Thiếu thông tin." });
    }
    if (!/^[A-Za-z]{3,15}$/.test(username)) {
        return res.status(400).json({ error: "Tên tài khoản không hợp lệ." });
    }
    if (password.length < 6 || !/[A-Z]/.test(password) || !/[0-9]/.test(password)) {
        return res.status(400).json({ error: "Mật khẩu yếu." });
    }

    const duplicate = await User.findOne({ $or: [{ username }] });
    if (duplicate) return res.status(400).json({ error: "Tài khoản đã tồn tại." });

    const hashed = await bcrypt.hash(password, SALT_ROUNDS);
    const user = new User({ username, password: hashed });
    await user.save();
    res.json({ success: true });
});

app.post("/api/login", async (req, res) => {
    const { username, password } = req.body;
    const user = await User.findOne({ username });
    if (!user || !(await bcrypt.compare(password, user.password))) {
        return res.status(401).json({ error: "Sai tài khoản hoặc mật khẩu" });
    }
    res.json({ success: true });
});

// ======== OOP GAME CODE GIỮ NGUYÊN ========
class PlayerObj {
    constructor(id, name = "NoName") {
        this.id = id;
        this.name = name;
        this.x = Math.random() * 5000;
        this.y = Math.random() * 5000;
        this.radius = 30;
        this.color = `hsl(${Math.random() * 360}, 100%, 50%)`;
        this.speed = 5;
    }
    move(dx, dy) {
        const len = Math.hypot(dx, dy);
        if (len > 0) {
            this.x += (dx / len) * this.speed;
            this.y += (dy / len) * this.speed;
        }
        this.x = Math.max(this.radius, Math.min(5000 - this.radius, this.x));
        this.y = Math.max(this.radius, Math.min(5000 - this.radius, this.y));
    }
}

class Food {
    constructor() {
        this.x = Math.random() * 5000;
        this.y = Math.random() * 5000;
        this.radius = 10;
        this.color = `hsl(${Math.random() * 360}, 100%, 50%)`;
    }
}

let foods = Array.from({ length: 200 }, () => new Food());

class SocketHandler {
    constructor(io, players) {
        this.io = io;
        this.players = players;
        this.init();
    }

    init() {
        this.io.on("connection", socket => {
            const player = new PlayerObj(socket.id);
            this.players[socket.id] = player;
            socket.emit("init", player);
            this.setupListeners(socket);
        });

        setInterval(() => {
            for (let pid in this.players) {
                const player = this.players[pid];
                for (let i = foods.length - 1; i >= 0; i--) {
                    const food = foods[i];
                    const dist = Math.hypot(player.x - food.x, player.y - food.y);
                    if (dist < player.radius + food.radius) {
                        player.radius += 1;
                        foods.splice(i, 1);
                        foods.push(new Food());
                    }
                }
            }

            for (let pid in this.players) {
                const p = this.players[pid];
                if (
                    p.x - p.radius <= 0 || p.x + p.radius >= 5000 ||
                    p.y - p.radius <= 0 || p.y + p.radius >= 5000
                ) {
                    delete this.players[pid];
                    continue;
                }

                for (let oid in this.players) {
                    if (oid === pid) continue;
                    const o = this.players[oid];
                    const dist = Math.hypot(p.x - o.x, p.y - o.y);
                    if (dist < p.radius + o.radius) {
                        if (p.radius > o.radius + 5) {
                            p.radius += o.radius * 0.2;
                            delete this.players[oid];
                        } else if (o.radius > p.radius + 5) {
                            o.radius += p.radius * 0.2;
                            delete this.players[pid];
                            break;
                        }
                    }
                }
            }

            this.io.emit("update", {
                players: Object.values(this.players),
                foods
            });
        }, 33);
    }

    setupListeners(socket) {
        socket.on("join", name => {
            const player = new PlayerObj(socket.id, name || "NoName");
            this.players[socket.id] = player;
            socket.emit("init", player);
        });

        socket.on("move", dir => {
            const player = this.players[socket.id];
            if (player) player.move(dir.x, dir.y);
        });

        socket.on("saveScore", data => {
            const p = new Player({ name: data.name, score: data.score });
            p.save();
        });

        socket.on("disconnect", () => {
            delete this.players[socket.id];
        });
    }
}

let players = {};
new SocketHandler(io, players);

const port = process.env.PORT || 3000;
http.listen(port, () => {
    console.log(`🚀 Server online tại cổng ${port}`);
});