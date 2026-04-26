import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { MercadoPagoConfig, Preference, Payment } from "mercadopago";
import { readFileSync, writeFileSync, existsSync } from "fs";

dotenv.config();

const app = express();

const PORT = process.env.PORT || 3001;
const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:5173";
const MP_BACKEND_URL =process.env.MP_BACKEND_URL || "https://mercadopago-backend-production.up.railway.app";

app.use(cors());
app.use(express.json());

if (!process.env.MP_ACCESS_TOKEN) {
console.error("Falta MP_ACCESS_TOKEN en variables de entorno");
}

const client = new MercadoPagoConfig({
accessToken: process.env.MP_ACCESS_TOKEN,
});

const ORDERS_FILE = "./orders-webhook-backup.json";

function getLocalOrders() {
if (!existsSync(ORDERS_FILE)) return [];

try {
return JSON.parse(readFileSync(ORDERS_FILE, "utf-8"));
} catch (error) {
console.error("Error leyendo archivo local:", error);
return [];
}
}

function saveLocalOrders(orders) {
writeFileSync(ORDERS_FILE, JSON.stringify(orders, null, 2));
}

app.get("/", (req, res) => {
res.send("Backend de Mercado Pago funcionando");
});

app.post("/create_preference", async (req, res) => {
try {
const { items, customer, externalReference } = req.body;

if (!items || !Array.isArray(items) || items.length === 0) {
return res.status(400).json({
error: "No hay productos para crear la preferencia",
});
}

const preference = new Preference(client);

const response = await preference.create({
body: {
items: items.map((item) => ({
title: item.name,
unit_price: Number(item.price),
quantity: Number(item.quantity),
currency_id: "MXN",
})),
payer: {
name: customer?.name || "",
email: customer?.email || "",
},
external_reference: externalReference || null,
notification_url: `${MP_BACKEND_URL}/webhook`,
back_urls: {
success: `${FRONTEND_URL}/payment/success?provider=mercadopago`,
failure: `${FRONTEND_URL}/payment/failure?provider=mercadopago`,
pending: `${FRONTEND_URL}/payment/pending?provider=mercadopago`,
},
auto_return: "approved",
},
});

res.json({
id: response.id,
});
} catch (error) {
console.error("Error creando preferencia:", error);

res.status(500).json({
error: "No se pudo crear la preferencia",
details: error?.message || String(error),
});
}
});

app.get("/payment-status/:id", async (req, res) => {
try {
const paymentId = req.params.id;

const paymentClient = new Payment(client);
const payment = await paymentClient.get({ id: paymentId });

res.json({
id: payment.id,
status: payment.status,
external_reference: payment.external_reference || null,
payer_email: payment.payer?.email || null,
transaction_amount: payment.transaction_amount || null,
});
} catch (error) {
console.error("Error consultando pago:", error);

res.status(500).json({
error: "No se pudo consultar el pago",
details: error?.message || String(error),
});
}
});

app.post("/webhook", async (req, res) => {
try {
console.log("=== WEBHOOK RECIBIDO ===");
console.log("Query:", req.query);
console.log("Body:", req.body);

res.sendStatus(200);

const topic =
req.query.type || req.query.topic || req.body.type || req.body.topic;

const resourceId =
req.body?.data?.id ||
req.query["data.id"] ||
req.query.id ||
req.body?.resource?.split("/").pop() ||
req.body?.id;

if (topic !== "payment" || !resourceId) {
console.log("No es un pago válido o no trae ID");
return;
}

const paymentClient = new Payment(client);
const payment = await paymentClient.get({ id: resourceId });

const orders = getLocalOrders();

orders.unshift({
webhookReceivedAt: new Date().toISOString(),
paymentId: payment.id,
paymentStatus: payment.status,
paymentStatusDetail: payment.status_detail,
externalReference: payment.external_reference || null,
payerEmail: payment.payer?.email || null,
transactionAmount: payment.transaction_amount || null,
raw: payment,
});

saveLocalOrders(orders);
} catch (error) {
console.error("Error procesando webhook:", error);
}
});

app.listen(PORT, "0.0.0.0", () => {
console.log(`Servidor Mercado Pago escuchando en puerto ${PORT}`);
});