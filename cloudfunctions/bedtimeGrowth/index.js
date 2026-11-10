const fs = require('node:fs')
const path = require('node:path')
const { expose } = require('common/response')
const { createPublicActions, validatePublicRequest, PUBLIC_FIELDS } = require('common/night-public')
const { createGrowthAnalyticsActions, validateGrowthAnalyticsRequest } = require('common/night-growth-analytics')
const { resolveConfig } = require('common/night-growth-config')

let privateConfig = {}
try { privateConfig = JSON.parse(fs.readFileSync(path.join(__dirname, 'private-config.json'), 'utf8')) }
catch (error) { if (error.code !== 'ENOENT') throw error }

exports.main = expose({ ...createPublicActions(), ...createGrowthAnalyticsActions({ config: resolveConfig(privateConfig) }) }, {
  validate: event => Object.hasOwn(PUBLIC_FIELDS, event.action) ? validatePublicRequest(event) : validateGrowthAnalyticsRequest(event)
})
