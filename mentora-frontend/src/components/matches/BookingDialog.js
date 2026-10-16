"use client";

import BookingSection from "@/components/matches/BookingSection";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/**
 * BookingSection in a dialog, so an accepted match can be booked from a
 * dashboard row as well as from its card on /matches. `match` needs
 * `match_id`, `mentor_id` and `name` (the mentor's name).
 */
export default function BookingDialog({ open, onOpenChange, match, onBooked }) {
  const mentorName = match?.name || match?.mentor_name || "your mentor";
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Book a meeting with {mentorName}</DialogTitle>
          <DialogDescription>
            Pick one of {mentorName}&apos;s open slots. The invite goes to both calendars with a Google Meet link.
          </DialogDescription>
        </DialogHeader>
        {match && (
          <BookingSection
            key={match.match_id}
            match={{ ...match, name: mentorName }}
            defaultOpen
            onBooked={onBooked}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
