import mongoose from 'mongoose'

export async function connectDb(uri: string) {
  mongoose.set('strictQuery', true)
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 5000 })
}

export const disconnectDb = () => mongoose.disconnect()
