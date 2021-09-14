import express from "express"
const router = express.Router()
import bcrypt from "bcryptjs"
import crypto from "crypto"
// Bring in Models & Helpers
import Merchant from "../../schemas/merchant.js"
import User from "../../schemas/UsersSchema.js"
import Brand from "../../schemas/brandSchema.js"
import { JWTAuthMiddleware } from "../../Auth/middlewares.js"
import { role } from "../../Auth/permissions.js"
import {
  merchantApplicationEmail,
  merchantSignUp,
  merchantWelcome,
} from "../../helpers/email.js"
router.post("/seller-request", async (req, res) => {
  try {
    const name = req.body.name
    const business = req.body.business
    const phoneNumber = req.body.phoneNumber
    const email = req.body.email
    const brand = req.body.brand

    if (!name || !email) {
      return res
        .status(400)
        .json({ error: "You must enter your name and email." })
    }

    if (!business) {
      return res
        .status(400)
        .json({ error: "You must enter a business description." })
    }

    if (!phoneNumber || !email) {
      return res
        .status(400)
        .json({ error: "You must enter a phone number and an email address." })
    }

    const existingMerchant = await Merchant.findOne({ email })

    if (existingMerchant) {
      return res
        .status(400)
        .json({ error: "That email address is already in use." })
    }

    const merchant = new Merchant({
      name,
      email,
      business,
      phoneNumber,
      brand,
    })

    const merchantDoc = await merchant.save()

    await merchantApplicationEmail(merchant)
    res.status(200).json({
      success: true,
      message: `We received your request! we will reach you on your phone number ${phoneNumber}!`,
      merchant: merchantDoc,
    })
  } catch (error) {
    return res.status(400).json({
      error: "Your request could not be processed. Please try again.",
    })
  }
})

// fetch all merchants api
router.get(
  "/list",
  JWTAuthMiddleware,
  role.checkRole(role.ROLES.Admin),
  async (req, res) => {
    try {
      const merchants = await Merchant.find({}).sort("-created")

      res.status(200).json({
        merchants,
      })
    } catch (error) {
      res.status(400).json({
        error: "Your request could not be processed. Please try again.",
      })
    }
  }
)

// approve merchant
router.put(
  "/approve/:merchantId",
  JWTAuthMiddleware,
  role.checkRole(role.ROLES.Admin),
  async (req, res) => {
    try {
      const merchantId = req.params.merchantId

      const query = { _id: merchantId }
      const update = {
        status: "Approved",
        isActive: true,
      }

      const merchantDoc = await Merchant.findOneAndUpdate(query, update, {
        new: true,
      })

      await createMerchantUser(
        merchantDoc.email,
        merchantDoc.name,
        merchantId,
        req.headers.host
      )

      res.status(200).json({
        success: true,
      })
    } catch (error) {
      console.log(error)
      res.status(400).json({
        error: "Your request could not be processed. Please try again.",
      })
    }
  }
)

// reject merchant
router.put(
  "/reject/:merchantId",
  JWTAuthMiddleware,
  role.checkRole(role.ROLES.Admin),
  async (req, res) => {
    try {
      const merchantId = req.params.merchantId

      const query = { _id: merchantId }
      const update = {
        status: "Rejected",
      }

      await Merchant.findOneAndUpdate(query, update, {
        new: true,
      })

      res.status(200).json({
        success: true,
      })
    } catch (error) {
      res.status(400).json({
        error: "Your request could not be processed. Please try again.",
      })
    }
  }
)

router.post("/signup/:token", JWTAuthMiddleware, async (req, res) => {
  try {
    const { email, firstName, lastName, password } = req.body

    if (!email) {
      return res.status(400).json({ error: "You must enter an email address." })
    }

    if (!firstName || !lastName) {
      return res.status(400).json({ error: "You must enter your full name." })
    }

    if (!password) {
      return res.status(400).json({ error: "You must enter a password." })
    }

    const userDoc = await User.findOne({
      email,
      refreshToken: req.params.token,
    })

    const salt = await bcrypt.genSalt(10)
    const hash = await bcrypt.hash(password, salt)

    const query = { _id: userDoc._id }
    const update = {
      email,
      firstName,
      lastName,
      password: hash,
      refreshToken: undefined,
    }

    await User.findOneAndUpdate(query, update, {
      new: true,
    })

    const merchantDoc = await Merchant.findOne({
      email,
    })

    await createMerchantBrand(merchantDoc)

    res.status(200).json({
      success: true,
    })
  } catch (error) {
    res.status(400).json({
      error: "Your request could not be processed. Please try again.",
    })
  }
})

router.delete(
  "/delete/:id",
  JWTAuthMiddleware,
  role.checkRole(role.ROLES.Admin),
  async (req, res) => {
    try {
      const merchant = await Merchant.deleteOne({ _id: req.params.id })

      res.status(200).json({
        success: true,
        message: `Merchant has been deleted successfully!`,
        merchant,
      })
    } catch (error) {
      res.status(400).json({
        error: "Your request could not be processed. Please try again.",
      })
    }
  }
)

const createMerchantBrand = async ({ _id, brand, business }) => {
  const newBrand = new Brand({
    name: brand,
    description: business,
    merchant: _id,
    isActive: false,
  })

  return await newBrand.save()
}

const createMerchantUser = async (email, name, merchant, host) => {
  const firstName = name
  const lastName = ""

  const existingUser = await User.findOne({ email })

  if (existingUser) {
    const query = { _id: existingUser._id }
    const update = {
      merchant,
      role: role.ROLES.Merchant,
    }

    const merchantDoc = await Merchant.findOne({
      email,
    })

    await createMerchantBrand(merchantDoc)

    await merchantWelcome(name, existingUser)
    return await User.findOneAndUpdate(query, update, {
      new: true,
    })
  } else {
    const buffer = await crypto.randomBytes(48)
    const resetToken = buffer.toString("hex")
    const refreshToken = resetToken

    const user = new User({
      email,
      firstName,
      lastName,
      refreshToken,
      merchant,
      role: role.ROLES.Merchant,
    })

    await merchantSignUp(host, { resetToken, user })
    return await user.save()
  }
}

export default router
