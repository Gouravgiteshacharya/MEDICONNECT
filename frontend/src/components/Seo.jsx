import { useEffect } from 'react'

const DEFAULT_TITLE = 'MediConnect — Find Medicines at Local Pharmacies'
const DEFAULT_DESCRIPTION = 'Find medicines at participating local pharmacies, compare current availability, and choose pickup or delivery.'

function upsertMeta(selector, attributes) {
  let element = document.head.querySelector(selector)
  if (!element) {
    element = document.createElement('meta')
    document.head.appendChild(element)
  }
  Object.entries(attributes).forEach(([name, value]) => element.setAttribute(name, value))
}

function upsertLink(rel, href) {
  let element = document.head.querySelector(`link[rel="${rel}"]`)
  if (!element) {
    element = document.createElement('link')
    element.rel = rel
    document.head.appendChild(element)
  }
  element.href = href
}

export default function Seo({ title = DEFAULT_TITLE, description = DEFAULT_DESCRIPTION, path = '/', noIndex = false }) {
  useEffect(() => {
    const configuredOrigin = import.meta.env.VITE_PUBLIC_SITE_URL?.trim()
    const origin = configuredOrigin || window.location.origin
    const canonicalUrl = new URL(path, origin).toString()
    const socialImage = new URL('/social-preview.jpg', origin).toString()

    document.title = title
    upsertMeta('meta[name="description"]', { name: 'description', content: description })
    upsertMeta('meta[name="robots"]', { name: 'robots', content: noIndex ? 'noindex, nofollow' : 'index, follow' })
    upsertMeta('meta[property="og:title"]', { property: 'og:title', content: title })
    upsertMeta('meta[property="og:description"]', { property: 'og:description', content: description })
    upsertMeta('meta[property="og:type"]', { property: 'og:type', content: 'website' })
    upsertMeta('meta[property="og:url"]', { property: 'og:url', content: canonicalUrl })
    upsertMeta('meta[property="og:image"]', { property: 'og:image', content: socialImage })
    upsertMeta('meta[name="twitter:card"]', { name: 'twitter:card', content: 'summary_large_image' })
    upsertMeta('meta[name="twitter:title"]', { name: 'twitter:title', content: title })
    upsertMeta('meta[name="twitter:description"]', { name: 'twitter:description', content: description })
    upsertMeta('meta[name="twitter:image"]', { name: 'twitter:image', content: socialImage })
    upsertLink('canonical', canonicalUrl)
  }, [description, noIndex, path, title])

  return null
}
