import { describe, expect, it } from 'vitest'
import { countryFlagUrl } from './countryFlag'

describe('countryFlagUrl', () => {
  it('resolves a lowercase code', () => {
    expect(countryFlagUrl('us')).toMatch(/\.svg(\?|$)/)
  })

  it('resolves an uppercase code', () => {
    expect(countryFlagUrl('GR')).toMatch(/\.svg(\?|$)/)
  })

  it('resolves a mixed-case code', () => {
    expect(countryFlagUrl('De')).toMatch(/\.svg(\?|$)/)
  })

  it('returns undefined for a non-two-letter code', () => {
    expect(countryFlagUrl('USA')).toBeUndefined()
    expect(countryFlagUrl('U')).toBeUndefined()
    expect(countryFlagUrl('')).toBeUndefined()
  })

  it('returns undefined for non-alphabetic input', () => {
    expect(countryFlagUrl('99')).toBeUndefined()
  })

  it('returns undefined for an unrecognized two-letter code', () => {
    expect(countryFlagUrl('ZZ')).toBeUndefined()
  })
})
