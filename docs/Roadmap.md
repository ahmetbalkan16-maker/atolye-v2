# Atölye V2 — Architecture

Atölye V2, AI destekli Türkçe belgesel üretim stüdyosudur.

## Ana Hedef

Kullanıcı bir tarih konusu girer. Sistem bu konuyu araştırır, senaryoya dönüştürür, sahnelere böler, görsel promptlar üretir, animasyon ve YouTube yayın paketine kadar süreci yönetir.

## Temel Pipeline

Topic
↓
Research
↓
Script
↓
Scenes
↓
Visuals
↓
Animation
↓
Voice
↓
YouTube

## Ana Katmanlar

### app/

Next.js App Router sayfaları ve API route dosyaları burada bulunur.

### src/components/

Arayüz bileşenleri burada bulunur.

### src/lib/

İş mantığı ve engine dosyaları burada bulunur.

### src/types/

Ortak TypeScript tipleri burada bulunur.

### data/projects/

JSON tabanlı proje kayıtları burada tutulur.

## Mimari Prensip

Atölye tek bir AI modeline bağlı kalmaz. İleride OpenAI, Gemini, Claude, Grok ve OpenRouter gibi farklı sağlayıcılar AI Orchestrator üzerinden yönetilecektir.

## Uzun Vadeli Hedef

Atölye, araştırmadan YouTube yayınına kadar tüm belgesel üretim sürecini tek çalışma alanında yöneten kişisel AI Studio olacaktır.