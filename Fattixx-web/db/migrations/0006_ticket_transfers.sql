-- Fat Tixx — migration 0006: ticket transfers.
--
-- A transfer never edits a ticket in place: the old ticket becomes 'transferred' (so its QR stops
-- scanning) and a fresh ticket with a new code and secret is issued to the recipient on the same order.
-- (ALTERs use MariaDB IF NOT EXISTS so a partly applied run can be repeated.)
-- tickets.transferred_from_id links the new ticket to the one it replaced; ticket_transfers is the history.

ALTER TABLE tickets
  ADD COLUMN IF NOT EXISTS transferred_from_id BIGINT UNSIGNED NULL AFTER ticket_type_id,
  ADD KEY IF NOT EXISTS idx_ticket_transferred_from (transferred_from_id),
  ADD KEY IF NOT EXISTS idx_ticket_attendee_email (attendee_email),
  ADD CONSTRAINT fk_ticket_transferred_from FOREIGN KEY IF NOT EXISTS (transferred_from_id) REFERENCES tickets(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS ticket_transfers (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  event_id        BIGINT UNSIGNED NOT NULL,
  order_id        BIGINT UNSIGNED NOT NULL,
  from_ticket_id  BIGINT UNSIGNED NOT NULL,
  to_ticket_id    BIGINT UNSIGNED NOT NULL,
  from_name       VARCHAR(160) NULL,
  from_email      VARCHAR(255) NULL,
  to_name         VARCHAR(160) NOT NULL,
  to_email        VARCHAR(255) NOT NULL,
  initiated_by    ENUM('holder','staff') NOT NULL,
  actor_user_id   BIGINT UNSIGNED NULL,
  note            VARCHAR(300) NULL,
  created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_ttr_event_time (event_id, created_at),
  KEY idx_ttr_order (order_id),
  CONSTRAINT fk_ttr_event  FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE,
  CONSTRAINT fk_ttr_order  FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
  CONSTRAINT fk_ttr_from   FOREIGN KEY (from_ticket_id) REFERENCES tickets(id) ON DELETE CASCADE,
  CONSTRAINT fk_ttr_to     FOREIGN KEY (to_ticket_id) REFERENCES tickets(id) ON DELETE CASCADE,
  CONSTRAINT fk_ttr_actor  FOREIGN KEY (actor_user_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
