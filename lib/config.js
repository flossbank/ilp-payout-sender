class Config {
  constructor ({ kms, dynamo }) {
    this.kms = kms
    this.configCache = new Map()
  }

  async decrypt (data) {
    return this.kms.decrypt({
      CiphertextBlob: Buffer.from(data, 'base64')
    }).promise().then(decrypted => decrypted.Plaintext.toString())
  }

  async getAndCacheValue (configKey) {
    if (this.configCache.has(configKey)) {
      return this.configCache.get(configKey)
    }
    const configValue = await this.dynamo.getConfigValue(configKey)
    this.configCache.set(configKey, configValue)

    return configValue
  }

  async getIlpConnectorAddress () {
    if (this.configCache.has('ilpConnectorAddress')) {
      return this.configCache.get('ilpConnectorAddress')
    }
    const ilpConnectorAddress = await this.decrypt(process.env.MONGO_URI)
    this.configCache.set('ilpConnectorAddress', ilpConnectorAddress)
    return ilpConnectorAddress
  }

  async getMongoUri () {
    if (this.configCache.has('mongoUri')) {
      return this.configCache.get('mongoUri')
    }
    const mongoUri = await this.decrypt(process.env.MONGO_URI)
    this.configCache.set('mongoUri', mongoUri)
    return mongoUri
  }
}

module.exports = Config
