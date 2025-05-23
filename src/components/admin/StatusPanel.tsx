
import { useState, useEffect } from "react";
import { DataCard } from "@/components/ui/DataCard";
import { formatTimeWithAmPm } from "@/utils/dateFormatUtils";
import { Minus } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/use-toast";
import { ConfirmationDialog } from "@/components/admin/ConfirmationDialog";
import { useFirebaseService } from "@/hooks/useFirebaseService";

interface Transaction {
  approved_at: string;
  end_time: string;
  slot_id: string;
  start_time: string;
  assign_to?: string;
  last_email?: string;
  last_password?: string;
  user_id?: number;
  hidden?: boolean;
}

interface StatusPanelProps {
  transactions: Record<string, any>;
  service: string;
}

export function StatusPanel({ transactions, service }: StatusPanelProps) {
  const [activeTransactions, setActiveTransactions] = useState<[string, Transaction][]>([]);
  const [expiredTransactions, setExpiredTransactions] = useState<[string, Transaction][]>([]);
  const [currentTime, setCurrentTime] = useState(new Date());
  const [selectedTransaction, setSelectedTransaction] = useState<[string, Transaction] | null>(null);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isConfirmationOpen, setIsConfirmationOpen] = useState(false);
  const { fetchData, updateData } = useFirebaseService(service);

  // Filter transactions into active and expired
  const filterTransactions = () => {
    const now = new Date();
    const active: [string, Transaction][] = [];
    const expired: [string, Transaction][] = [];

    Object.entries(transactions).forEach(([id, data]) => {
      // Skip entries that are just numbers (counters)
      if (typeof data === "number") return;
      
      const transaction = data as Transaction;
      if (!transaction.end_time) return;
      
      // Skip hidden transactions
      if (transaction.hidden === true) return;

      // Parse the end time
      const endTime = new Date(transaction.end_time.replace(' ', 'T'));
      
      if (endTime > now) {
        active.push([id, transaction]);
      } else {
        // Only include expired transactions that are less than 24 hours old
        const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
        if (endTime > twentyFourHoursAgo) {
          expired.push([id, transaction]);
        }
      }
    });

    // Sort by end time (most recent expiring first for active, most recently expired first for expired)
    active.sort((a, b) => 
      new Date(a[1].end_time.replace(' ', 'T')).getTime() - 
      new Date(b[1].end_time.replace(' ', 'T')).getTime()
    );
    
    expired.sort((a, b) => 
      new Date(b[1].end_time.replace(' ', 'T')).getTime() - 
      new Date(a[1].end_time.replace(' ', 'T')).getTime()
    );

    setActiveTransactions(active);
    setExpiredTransactions(expired);
  };

  // Initialize and set up auto-refresh
  useEffect(() => {
    filterTransactions();
    
    // Set up minute-by-minute refresh
    const intervalId = setInterval(() => {
      setCurrentTime(new Date());
      filterTransactions();
    }, 60000); // Refresh every minute
    
    return () => clearInterval(intervalId);
  }, [transactions]);

  // Also refresh when currentTime updates
  useEffect(() => {
    filterTransactions();
  }, [currentTime]);

  const openTransactionDetails = (transaction: [string, Transaction]) => {
    setSelectedTransaction(transaction);
    setIsDialogOpen(true);
  };

  // Custom formatting function to separate hours+minutes from AM/PM
  const formatTimeWithCustomFonts = (timeString: string) => {
    const formattedTime = formatTimeWithAmPm(timeString);
    const parts = formattedTime.split(' ');
    
    if (parts.length === 2) {
      return (
        <>
          <span className="time-hour-minute">{parts[0]}</span>
          <span className="time-am-pm">{parts[1]}</span>
        </>
      );
    }
    
    return formattedTime;
  };

  // Mark expired orders as hidden and update credentials
  const handleClearExpired = async () => {
    try {
      // Get all the credential data
      const credData = await fetchData("/");
      
      // Counter for cleared orders
      let clearedCount = 0;
      let errorCount = 0;

      // Process each expired transaction
      const processingPromises = expiredTransactions.map(async ([id, transaction]) => {
        try {
          // Mark the transaction as hidden in the database
          await updateData(`/transactions/${id}`, {
            hidden: true
          });
          
          // Only update credential usage if it has assign_to property
          if (transaction.assign_to) {
            const credKey = transaction.assign_to;
            
            // Check if the credential exists in the database
            if (credData[credKey] && typeof credData[credKey].usage_count === 'number') {
              // Decrement the usage count, ensuring it doesn't go below 0
              const currentCount = credData[credKey].usage_count;
              const newCount = Math.max(0, currentCount - 1);
              
              // Update the credential's usage count
              await updateData(`/${credKey}`, {
                usage_count: newCount
              });
            }
          }
          
          clearedCount++;
        } catch (e) {
          console.error(`Error processing transaction ${id}:`, e);
          errorCount++;
        }
      });
      
      // Wait for all processes to complete
      await Promise.all(processingPromises);
      
      // Clear expired transactions from UI
      setExpiredTransactions([]);
      
      // Show appropriate toast message
      if (errorCount > 0) {
        if (clearedCount > 0) {
          toast({
            title: "Partially Completed",
            description: `Cleared ${clearedCount} orders, but ${errorCount} failed. Some usage counts updated.`,
            variant: "default"
          });
        } else {
          toast({
            title: "Failed to Clear Orders",
            description: "Could not clear any expired orders. Please try again.",
            variant: "destructive"
          });
        }
      } else {
        toast({
          title: "Success",
          description: `Cleared ${clearedCount} expired orders. Usage counts updated.`,
          variant: "default"
        });
      }
    } catch (error) {
      console.error("Error clearing expired orders:", error);
      toast({
        title: "Error",
        description: "Failed to clear expired orders. Please try again.",
        variant: "destructive"
      });
    } finally {
      setIsConfirmationOpen(false);
    }
  };

  return (
    <div className="space-y-6">
      <DataCard 
        title="Account Status" 
        headerAction={
          expiredTransactions.length > 0 ? (
            <Button 
              variant="outline" 
              size="sm"
              onClick={() => setIsConfirmationOpen(true)}
              className="text-sm"
            >
              Clear
            </Button>
          ) : null
        }
      >
        <div className="space-y-10 py-4">
          {/* Active Section */}
          <div className="space-y-6">
            <h2 className="text-2xl font-bold uppercase tracking-wider">ACTIVE</h2>
            
            <div className="grid grid-cols-3 gap-3 sm:grid-cols-3 xs:grid-cols-2 max-[400px]:grid-cols-3 max-[400px]:gap-2">
              {activeTransactions.length > 0 ? (
                activeTransactions.map(([id, transaction]) => (
                  <button
                    key={id}
                    onClick={() => openTransactionDetails([id, transaction])}
                    className="time-button active-time-button max-[400px]:w-full max-[400px]:mx-auto"
                  >
                    <span className="time-text">
                      {formatTimeWithCustomFonts(transaction.end_time)}
                    </span>
                  </button>
                ))
              ) : (
                <div className="text-center col-span-3 max-[400px]:col-span-3 py-6">
                  <p className="text-white/60">No active accounts</p>
                </div>
              )}
            </div>
          </div>
          
          {/* Divider */}
          <div className="flex items-center justify-center py-1">
            <Minus className="w-full h-0.5 text-white/50" />
          </div>
          
          {/* Expired Section */}
          <div className="space-y-6">
            <h2 className="text-2xl font-bold uppercase text-white tracking-wider">EXPIRED</h2>
            
            <div className="grid grid-cols-3 gap-3 sm:grid-cols-3 xs:grid-cols-2 max-[400px]:grid-cols-3 max-[400px]:gap-2">
              {expiredTransactions.length > 0 ? (
                expiredTransactions.map(([id, transaction]) => (
                  <button
                    key={id}
                    onClick={() => openTransactionDetails([id, transaction])}
                    className="time-button expired-time-button max-[400px]:w-full max-[400px]:mx-auto"
                  >
                    <span className="time-text text-red-400">
                      {formatTimeWithCustomFonts(transaction.end_time)}
                    </span>
                  </button>
                ))
              ) : (
                <div className="text-center col-span-3 max-[400px]:col-span-3 py-6">
                  <p className="text-white/60">No expired accounts</p>
                </div>
              )}
            </div>
          </div>
        </div>
      </DataCard>
      
      {/* Transaction Details Dialog */}
      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="bg-black border-white/10 backdrop-blur-xl text-white max-w-sm max-[400px]:max-w-[90%] dialog-animation">
          {selectedTransaction && (
            <>
              <DialogHeader>
                <DialogTitle className="text-center">Account Details</DialogTitle>
              </DialogHeader>
              <div className="space-y-4 mt-4">
                <div className="flex justify-between">
                  <span className="text-white/60">ID:</span>
                  <span className="break-all">{selectedTransaction[0]}</span>
                </div>
                
                <div className="flex justify-between">
                  <span className="text-white/60">Slot:</span>
                  <span>{selectedTransaction[1].slot_id}</span>
                </div>
                
                <div className="grid grid-cols-3 gap-4 max-[400px]:grid-cols-1 max-[400px]:gap-2">
                  {selectedTransaction[1].start_time && (
                    <div className="text-center">
                      <div className="text-sm text-white/60 mb-1">Start</div>
                      <div className="dialog-time-button">
                        <span className="inline-flex items-center justify-center">
                          <span className="time-hour-minute">{formatTimeWithAmPm(selectedTransaction[1].start_time).split(' ')[0]}</span>
                          <span className="time-am-pm">{formatTimeWithAmPm(selectedTransaction[1].start_time).split(' ')[1]}</span>
                        </span>
                      </div>
                    </div>
                  )}
                  
                  {selectedTransaction[1].approved_at && (
                    <div className="text-center">
                      <div className="text-sm text-white/60 mb-1">Approved</div>
                      <div className="dialog-time-button">
                        <span className="inline-flex items-center justify-center">
                          <span className="time-hour-minute">{formatTimeWithAmPm(selectedTransaction[1].approved_at).split(' ')[0]}</span>
                          <span className="time-am-pm">{formatTimeWithAmPm(selectedTransaction[1].approved_at).split(' ')[1]}</span>
                        </span>
                      </div>
                    </div>
                  )}
                  
                  {selectedTransaction[1].end_time && (
                    <div className="text-center">
                      <div className="text-sm text-white/60 mb-1">End</div>
                      <div className={cn(
                        "dialog-time-button",
                        new Date(selectedTransaction[1].end_time.replace(' ', 'T')) < new Date() ? "text-red-400" : ""
                      )}>
                        <span className="inline-flex items-center justify-center">
                          <span className="time-hour-minute">{formatTimeWithAmPm(selectedTransaction[1].end_time).split(' ')[0]}</span>
                          <span className="time-am-pm">{formatTimeWithAmPm(selectedTransaction[1].end_time).split(' ')[1]}</span>
                        </span>
                      </div>
                    </div>
                  )}
                </div>
                
                {selectedTransaction[1].assign_to && (
                  <div className="text-center mt-4">
                    <p className="font-semibold max-[400px]:break-all">Account: {selectedTransaction[1].assign_to}</p>
                  </div>
                )}
                
                {selectedTransaction[1].last_email && (
                  <div className="text-center">
                    <p className="text-sm max-[400px]:break-all">Email: {selectedTransaction[1].last_email}</p>
                  </div>
                )}
                
                {selectedTransaction[1].user_id && (
                  <div className="text-center">
                    <p className="text-sm text-white/60">User ID: {selectedTransaction[1].user_id}</p>
                  </div>
                )}
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Confirmation Dialog for Clear Expired Orders */}
      <ConfirmationDialog
        open={isConfirmationOpen}
        onOpenChange={setIsConfirmationOpen}
        title="Clear Expired Orders"
        description="Are you sure you want to clear all expired orders? This will also decrement usage counts on their accounts."
        onConfirm={handleClearExpired}
      />
    </div>
  );
}
