export const config = {
  port: Number(process.env.PORT) || 4000,
  mongoUri: process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/jackal',
  clientOrigin: process.env.CLIENT_ORIGIN || 'http://localhost:5173',
}
