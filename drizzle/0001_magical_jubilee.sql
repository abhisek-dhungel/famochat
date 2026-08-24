CREATE TABLE `live_contexts` (
	`user_id` text PRIMARY KEY NOT NULL,
	`latitude` real NOT NULL,
	`longitude` real NOT NULL,
	`location_label` text NOT NULL,
	`temperature` real,
	`weather` text DEFAULT 'Unavailable' NOT NULL,
	`battery` integer,
	`charging` integer,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_live_contexts_updated` ON `live_contexts` (`updated_at`);