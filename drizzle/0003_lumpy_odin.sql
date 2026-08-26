CREATE TABLE `message_reactions` (
	`message_id` integer NOT NULL,
	`user_id` text NOT NULL,
	`emoji` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`message_id`, `user_id`),
	FOREIGN KEY (`message_id`) REFERENCES `messages`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_reactions_message` ON `message_reactions` (`message_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `typing_indicators` (
	`user_id` text NOT NULL,
	`recipient_id` text NOT NULL,
	`expires_at` integer NOT NULL,
	PRIMARY KEY(`user_id`, `recipient_id`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`recipient_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_typing_recipient_expiry` ON `typing_indicators` (`recipient_id`,`expires_at`);--> statement-breakpoint
ALTER TABLE `messages` ADD `client_id` text;--> statement-breakpoint
ALTER TABLE `messages` ADD `reply_to_id` integer REFERENCES messages(id);--> statement-breakpoint
ALTER TABLE `messages` ADD `edited_at` integer;--> statement-breakpoint
ALTER TABLE `messages` ADD `deleted_at` integer;--> statement-breakpoint
ALTER TABLE `messages` ADD `read_at` integer;--> statement-breakpoint
CREATE UNIQUE INDEX `idx_messages_sender_client` ON `messages` (`sender_id`,`client_id`);--> statement-breakpoint
ALTER TABLE `users` ADD `last_seen_at` integer;