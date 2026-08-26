CREATE TABLE `location_pause_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`requester_id` text NOT NULL,
	`approver_id` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`requester_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`approver_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `location_pause_request_unique` ON `location_pause_requests` (`requester_id`,`approver_id`);--> statement-breakpoint
CREATE INDEX `idx_location_pause_approver_created` ON `location_pause_requests` (`approver_id`,`created_at`);