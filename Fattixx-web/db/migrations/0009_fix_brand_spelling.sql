-- Fattixx — migration 0009: correct the brand spelling in stored settings ("Fat Tixx" -> "Fattixx").
UPDATE platform_settings SET `value` = REPLACE(`value`, 'Fat Tixx', 'Fattixx') WHERE `value` LIKE '%Fat Tixx%';
UPDATE email_templates SET subject = REPLACE(subject, 'Fat Tixx', 'Fattixx'), body_html = REPLACE(body_html, 'Fat Tixx', 'Fattixx')
  WHERE subject LIKE '%Fat Tixx%' OR body_html LIKE '%Fat Tixx%';
